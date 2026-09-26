// Refresh tokens were stateless 7-day JWTs, delivered only as a cookie scoped to
// a path no deployed route answered on, so refresh never worked, logout could
// not revoke anything and a stolen token lived for a week. They are now stored,
// rotated on each use, revocable, and available in the body for mobile clients
// that ask (`includeRefreshToken: true`).
//
// The Mongo model is replaced with an in-memory stand-in so the real store and
// the real HTTP handlers run together.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const { rows, FakeModel } = vi.hoisted(() => {
  const rows = [];
  const matches = (row, filter) =>
    Object.entries(filter).every(([key, cond]) => {
      if (cond && typeof cond === 'object' && '$gt' in cond) return row[key] > cond.$gt;
      return row[key] === cond;
    });
  const lean = (value) => ({ lean: async () => (value ? { ...value } : null) });
  const FakeModel = {
    create: vi.fn(async (doc) => { rows.push({ usedAt: null, ...doc }); }),
    findOneAndUpdate: vi.fn((filter, update) => {
      const row = rows.find((r) => matches(r, filter));
      const before = row ? { ...row } : null;
      if (row) Object.assign(row, update.$set);
      return lean(before);
    }),
    findOne: vi.fn((filter) => lean(rows.find((r) => matches(r, filter)))),
    deleteMany: vi.fn(async (filter) => {
      const doomed = rows.filter((r) => matches(r, filter));
      doomed.forEach((r) => rows.splice(rows.indexOf(r), 1));
      return { deletedCount: doomed.length };
    }),
  };
  return { rows, FakeModel };
});

vi.mock('../src/models/sessionRefreshToken.js', () => ({ default: FakeModel }));

const store = await import('../src/utils/sessionRefreshStore.js');
const session = await import('../src/utils/session.js');
const { REUSE_GRACE_MS } = store;

function mockRes() {
  const res = { statusCode: 200, body: null, cookies: {}, cleared: [] };
  res.status = vi.fn((c) => { res.statusCode = c; return res; });
  res.json = vi.fn((b) => { res.body = b; return res; });
  res.cookie = vi.fn((name, value, options) => { res.cookies[name] = { value, options }; return res; });
  res.clearCookie = vi.fn((name, options) => { res.cleared.push({ name, path: options?.path }); return res; });
  return res;
}

async function refreshBody(refreshToken) {
  const res = mockRes();
  await session.refreshFromBody({ body: { refreshToken } }, res);
  return res;
}

beforeEach(() => {
  rows.length = 0;
  vi.clearAllMocks();
  process.env.ACCESS_TOKEN_SECRET = 'test-secret';
  delete process.env.JWT_SIGNING_ALG;
});

afterEach(() => vi.useRealTimers());

describe('startSession', () => {
  it('stores nothing and returns no refresh token for a plain login', async () => {
    const res = mockRes();
    const result = await session.startSession({ body: {} }, res, 'user-1');

    expect(result).toEqual({ accesstoken: expect.any(String) });
    expect(rows).toHaveLength(0);
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('returns a refresh token in the body only when asked', async () => {
    const result = await session.startSession({ body: { includeRefreshToken: true } }, mockRes(), 'user-1');

    expect(result.refreshToken).toEqual(expect.any(String));
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toBe(result.refreshToken);
  });

  it('sets a site-wide httpOnly cookie without putting the token in the body', async () => {
    const res = mockRes();
    const result = await session.startSession({ body: {} }, res, 'user-1', { setCookie: true });

    expect(result.refreshToken).toBeUndefined();
    expect(res.cookies.refreshtoken.options).toMatchObject({ httpOnly: true, path: '/' });
    expect(res.cookies.refreshtoken.options.maxAge).toBe(store.SESSION_REFRESH_TTL_SECONDS * 1000);
  });
});

describe('POST /auth/refresh (body)', () => {
  it('exchanges a refresh token for a new pair', async () => {
    const first = await store.issueRefreshToken('user-1');
    const res = await refreshBody(first);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ accesstoken: expect.any(String), refreshToken: expect.any(String) });
    expect(res.body.refreshToken).not.toBe(first);
  });

  it('keeps the session going across rotations', async () => {
    let token = await store.issueRefreshToken('user-1');
    for (let i = 0; i < 3; i += 1) {
      const res = await refreshBody(token);
      expect(res.statusCode).toBe(200);
      token = res.body.refreshToken;
    }
  });

  it.each([
    ['missing', undefined],
    ['unknown', 'never-issued'],
    ['a query operator', { $ne: null }],
  ])('rejects a %s token with 401', async (_label, token) => {
    const res = await refreshBody(token);

    expect(res.statusCode).toBe(401);
  });

  it('rejects an expired token', async () => {
    const token = await store.issueRefreshToken('user-1');
    rows[0].expiresAt = new Date(Date.now() - 1000);

    expect((await refreshBody(token)).statusCode).toBe(401);
  });

  it('refuses a racing second use without ending the session', async () => {
    const first = await store.issueRefreshToken('user-1');
    const winner = await refreshBody(first);
    const racer = await refreshBody(first);

    expect(racer.statusCode).toBe(401);
    expect((await refreshBody(winner.body.refreshToken)).statusCode).toBe(200);
  });

  it('ends the whole session when a spent token comes back after the grace window', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    const stolen = await store.issueRefreshToken('user-1');
    const legit = await refreshBody(stolen);

    vi.setSystemTime(Date.now() + REUSE_GRACE_MS + 1000);
    const replay = await refreshBody(stolen);

    expect(replay.statusCode).toBe(401);
    // The legitimate holder's newer token died with the family.
    expect((await refreshBody(legit.body.refreshToken)).statusCode).toBe(401);
  });

  it('only ends the replayed session, not the user\'s other sessions', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    const phone = await store.issueRefreshToken('user-1');
    const laptop = await store.issueRefreshToken('user-1');
    await refreshBody(phone);

    vi.setSystemTime(Date.now() + REUSE_GRACE_MS + 1000);
    await refreshBody(phone);

    expect((await refreshBody(laptop)).statusCode).toBe(200);
  });
});

describe('GET .../refresh_token (cookie)', () => {
  it('rotates the cookie and returns a new access token', async () => {
    const first = await store.issueRefreshToken('user-1');
    const res = mockRes();
    await session.refreshFromCookie({ cookies: { refreshtoken: first } }, res);

    expect(res.body).toEqual({ accesstoken: expect.any(String) });
    expect(res.cookies.refreshtoken.value).not.toBe(first);
  });

  it('keeps the old messages clients recognise as a signed-out session', async () => {
    const none = mockRes();
    await session.refreshFromCookie({ cookies: {} }, none);
    const bad = mockRes();
    await session.refreshFromCookie({ cookies: { refreshtoken: 'never-issued' } }, bad);

    expect(none.statusCode).toBe(400);
    expect(none.body.msg).toBe('Please Login or Register');
    expect(bad.statusCode).toBe(400);
    expect(bad.body.msg).toBe('Please Verify Info & Login or Register');
  });
});

describe('logout and password reset', () => {
  it('logout revokes the presented session and clears both cookie paths', async () => {
    const token = await store.issueRefreshToken('user-1');
    const res = mockRes();
    await session.endSession({ body: { refreshToken: token }, cookies: {} }, res);

    expect(res.body).toEqual({ msg: 'Logged Out', status: 'Successful' });
    expect(res.cleared.map((c) => c.path)).toEqual(['/', '/api/auth/refresh_token']);
    expect((await refreshBody(token)).statusCode).toBe(401);
  });

  it('logout without a token still succeeds', async () => {
    const res = mockRes();
    await session.endSession({ body: {}, cookies: {} }, res);

    expect(res.body.status).toBe('Successful');
  });

  it('revokeAllForUser ends every session for that user only', async () => {
    const mine = await store.issueRefreshToken('user-1');
    const theirs = await store.issueRefreshToken('user-2');

    await store.revokeAllForUser('user-1');

    expect((await refreshBody(mine)).statusCode).toBe(401);
    expect((await refreshBody(theirs)).statusCode).toBe(200);
  });
});
