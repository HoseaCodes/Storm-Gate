// Production (Lambda) had no rate limiting: the in-memory limiter only runs
// locally. Limits are now counted in MongoDB and applied per client IP and,
// for login and password reset, per email.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const { windows, FakeWindow } = vi.hoisted(() => {
  const windows = new Map();
  const FakeWindow = {
    fail: false,
    findOneAndUpdate: vi.fn((filter, update) => ({
      lean: async () => {
        if (FakeWindow.fail) throw new Error('connection refused');
        const row = windows.get(filter._id) ?? { _id: filter._id, count: 0, ...update.$setOnInsert };
        row.count += update.$inc.count;
        windows.set(filter._id, row);
        return { ...row };
      },
    })),
  };
  return { windows, FakeWindow };
});

vi.mock('../src/models/rateLimitWindow.js', () => ({ default: FakeWindow }));

const { checkRateLimit, rateLimit, authLimits } = await import('../src/utils/rateLimit.js');

function mockRes() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.status = vi.fn((c) => { res.statusCode = c; return res; });
  res.json = vi.fn((b) => { res.body = b; return res; });
  res.set = vi.fn((k, v) => { res.headers[k] = v; return res; });
  return res;
}

async function hit(middleware, { ip = '203.0.113.7', email } = {}) {
  const res = mockRes();
  const next = vi.fn();
  await middleware({ ip, body: email === undefined ? {} : { email } }, res, next);
  return { res, passed: next.mock.calls.length === 1 };
}

beforeEach(() => {
  windows.clear();
  FakeWindow.fail = false;
  vi.clearAllMocks();
});

describe('checkRateLimit', () => {
  it('allows up to the limit within a window, then refuses', async () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 30);
    const results = [];
    for (let i = 0; i < 4; i += 1) results.push(await checkRateLimit('k', 3, 60_000, now));

    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3].retryAfterSec).toBe(30);
  });

  it('starts a fresh count in the next window', async () => {
    const start = Date.UTC(2026, 0, 1);
    for (let i = 0; i < 3; i += 1) await checkRateLimit('k', 3, 60_000, start);

    expect((await checkRateLimit('k', 3, 60_000, start + 60_000)).allowed).toBe(true);
  });
});

describe('rateLimit middleware', () => {
  const limiter = rateLimit('test', [
    { scope: 'ip', limit: 3, windowMs: 60_000 },
    { scope: 'email', limit: 2, windowMs: 60_000 },
  ]);

  it('answers 429 with Retry-After once an IP is over its limit', async () => {
    for (let i = 0; i < 3; i += 1) expect((await hit(limiter)).passed).toBe(true);
    const { res, passed } = await hit(limiter);

    expect(passed).toBe(false);
    expect(res.statusCode).toBe(429);
    expect(Number(res.headers['Retry-After'])).toBeGreaterThan(0);
  });

  it('counts IPs separately', async () => {
    for (let i = 0; i < 3; i += 1) await hit(limiter, { ip: '203.0.113.1' });

    expect((await hit(limiter, { ip: '203.0.113.2' })).passed).toBe(true);
  });

  it('limits one account across many IPs', async () => {
    await hit(limiter, { ip: '198.51.100.1', email: 'victim@example.com' });
    await hit(limiter, { ip: '198.51.100.2', email: 'Victim@Example.com ' });
    const third = await hit(limiter, { ip: '198.51.100.3', email: 'victim@example.com' });

    expect(third.passed).toBe(false);
    expect(third.res.statusCode).toBe(429);
  });

  it('stores emails hashed, never in plain text', async () => {
    await hit(limiter, { email: 'victim@example.com' });

    expect([...windows.keys()].some((k) => k.includes('victim'))).toBe(false);
  });

  it('skips email rules when no email is sent', async () => {
    const { passed } = await hit(limiter);

    expect(passed).toBe(true);
    expect([...windows.keys()].every((k) => k.startsWith('test:ip:'))).toBe(true);
  });

  it('allows the request when the counter store is down', async () => {
    FakeWindow.fail = true;
    const log = { error: vi.fn() };
    const failing = rateLimit('test', [{ scope: 'ip', limit: 1, windowMs: 60_000 }], { log });

    const { passed } = await hit(failing);

    expect(passed).toBe(true);
    expect(log.error).toHaveBeenCalled();
  });

  it('login allows 10 attempts per email per window', async () => {
    for (let i = 0; i < 10; i += 1) {
      expect((await hit(authLimits.login, { ip: `192.0.2.${i}`, email: 'a@example.com' })).passed).toBe(true);
    }
    expect((await hit(authLimits.login, { ip: '192.0.2.99', email: 'a@example.com' })).passed).toBe(false);
  });
});

describe('route wiring', () => {
  const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
  const lambda = read('src/lambda-app.js');
  const authRoutes = read('src/routes/auth.js');

  // Each public action is reachable twice on Lambda (/x and /auth/x) and must
  // be limited on both, by the same limiter instance so they share a count.
  it.each([
    ["app.post('/register', authLimits.register,", 'router.post("/register", authLimits.register,'],
    ["app.post('/login', authLimits.login,", 'router.post("/login", authLimits.login,'],
    ["app.post('/forgot-password', authLimits.forgotPassword,", 'router.post("/forgot-password", authLimits.forgotPassword,'],
    ["app.post('/reset-password/:token', authLimits.resetPassword,", 'router.post("/reset-password/:token", authLimits.resetPassword,'],
    ["app.post('/verify-reset-token/:token', authLimits.resetPassword,", 'router.post("/verify-reset-token/:token", authLimits.resetPassword,'],
  ])('limits %s and its /auth twin', (lambdaRoute, routerRoute) => {
    expect(lambda).toContain(lambdaRoute);
    expect(authRoutes).toContain(routerRoute);
  });

  it.each([
    'router.post("/guest-login", authLimits.guestLogin,',
    'router.get("/refresh_token", authLimits.refresh,',
    'router.post("/refresh", authLimits.refresh,',
    'router.post("/verify-email", authLimits.verifyEmail,',
    'router.post("/resend-verification", authLimits.resendVerification,',
  ])('limits %s', (route) => {
    expect(authRoutes).toContain(route);
  });

  it('limits /check-status', () => {
    expect(lambda).toContain("app.post('/check-status', authLimits.checkStatus,");
  });

  it('keeps trust proxy off so X-Forwarded-For cannot pick the IP', () => {
    expect(lambda).not.toMatch(/app\.set\(\s*['"]trust proxy['"]/);
  });
});
