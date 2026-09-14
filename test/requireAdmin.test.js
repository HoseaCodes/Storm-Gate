// The three approval routes were authenticated but never authorized.
//
// enhancedVerifyJWT admits any token carrying `decoded.id`, and
// /auth/guest-login is unauthenticated — anyone can call it and receive a valid
// token with an id. That made approving and denying user registrations, the
// decision of who gets into the system at all, reachable anonymously.
//
// The composed test at the bottom is the one that matters: it mints a real guest
// token and pushes it through the actual enhancedVerifyJWT -> requireAdmin chain
// the routes use.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';

import { makeKeypair, mockRes, snapshotEnv, restoreEnv } from './helpers.js';

vi.mock('../src/models/user.js', () => ({
  default: { findById: vi.fn(), findOne: vi.fn(), find: vi.fn() },
}));

const Users = (await import('../src/models/user.js')).default;
const requireAdmin = (await import('../src/utils/requireAdmin.js')).default;

// findById(...).select(...) — mirror the chain the middleware calls.
function resolvesTo(doc) {
  Users.findById.mockReturnValue({ select: vi.fn().mockResolvedValue(doc) });
}
function rejectsWith(err) {
  Users.findById.mockReturnValue({ select: vi.fn().mockRejectedValue(err) });
}

const admin = { _id: 'admin-1', role: 'admin', status: 'APPROVED' };

function run(req) {
  const res = mockRes();
  const next = vi.fn();
  return requireAdmin(req, res, next).then(() => ({ res, next }));
}

let env;
beforeEach(() => {
  env = snapshotEnv();
  vi.clearAllMocks();
});
afterEach(() => restoreEnv(env));

describe('requireAdmin', () => {
  it('admits an approved admin', async () => {
    resolvesTo(admin);
    const { res, next } = await run({ user: { id: 'admin-1' } });

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('admits a superAdmin', async () => {
    resolvesTo({ _id: 'root', role: 'superAdmin', status: 'APPROVED' });
    const { next } = await run({ user: { id: 'root' } });
    expect(next).toHaveBeenCalledOnce();
  });

  // The hole. A guest token is issued to anyone who asks, unauthenticated.
  it('refuses a guest token', async () => {
    resolvesTo(admin); // even if the lookup somehow returned an admin
    const { res, next } = await run({ user: { id: 'guest-1', isGuest: true } });

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    // Rejected on the flag alone — the database is never consulted.
    expect(Users.findById).not.toHaveBeenCalled();
  });

  it('refuses an ordinary signed-in user', async () => {
    resolvesTo({ _id: 'u1', role: 'basic', status: 'APPROVED' });
    const { res, next } = await run({ user: { id: 'u1' } });

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('refuses a token whose subject no longer exists', async () => {
    resolvesTo(null);
    const { res, next } = await run({ user: { id: 'deleted' } });

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it.each(['PENDING', 'DENIED'])(
    'refuses an admin whose own account is %s',
    async (status) => {
      resolvesTo({ _id: 'a1', role: 'admin', status });
      const { res, next } = await run({ user: { id: 'a1' } });

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    },
  );

  it('requires an authenticated caller', async () => {
    const { res, next } = await run({});
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  // The old middleware read req.params.id, so a caller could nominate whichever
  // account it wanted checked. Authorization must follow the verified token.
  it('authorizes on the token subject, never on a URL parameter', async () => {
    resolvesTo({ _id: 'u1', role: 'basic', status: 'APPROVED' });

    const { res, next } = await run({
      user: { id: 'u1' },              // the real, verified caller
      params: { id: 'admin-1' },       // an id they simply asked for
    });

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(Users.findById).toHaveBeenCalledWith('u1');
    expect(Users.findById).not.toHaveBeenCalledWith('admin-1');
  });

  // An authorization check that cannot complete is not a pass.
  it('fails closed when the lookup errors', async () => {
    rejectsWith(new Error('database unavailable'));
    const { res, next } = await run({ user: { id: 'admin-1' } });

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(500);
  });

  it('records who authorized the action', async () => {
    resolvesTo(admin);
    const req = { user: { id: 'admin-1' } };
    await run(req);

    expect(req.admin).toEqual({ id: 'admin-1', role: 'admin' });
  });
});

// End to end through the real chain the routes wire up.
describe('the approval routes, as composed', () => {
  it('stops a genuine guest token before it reaches the handler', async () => {
    const kp = makeKeypair();
    process.env.ACCESS_TOKEN_SECRET = 'test-hs-secret';
    process.env.JWT_SIGNING_ALG = 'RS256';
    process.env.JWT_PRIVATE_KEY = kp.privateKey;
    process.env.TENANT_ID = 'test-tenant';

    const { resetSigningKeys } = await import('../src/utils/signingKeys.js');
    resetSigningKeys();
    const enhancedVerifyJWT = (await import('../src/utils/enhancedAuth.js')).default;

    // Exactly what /auth/guest-login issues: an id, and isGuest.
    const guestToken = jwt.sign(
      { id: '6aa5030b1e85b042fcedacbd', isGuest: true },
      kp.privateKey,
      { algorithm: 'RS256', keyid: kp.kid, expiresIn: '1h' },
    );

    const req = {
      headers: { authorization: `Bearer ${guestToken}` },
      header: (n) => req.headers[n.toLowerCase()],
    };
    const res = mockRes();

    let reachedHandler = false;
    const handler = () => { reachedHandler = true; };

    // enhancedVerifyJWT -> requireAdmin -> handler
    await new Promise((resolve) => {
      enhancedVerifyJWT(req, res, () => {
        requireAdmin(req, res, handler).then(resolve);
      });
      setTimeout(resolve, 200);
    });

    // Authentication succeeds — the token is genuinely valid.
    expect(req.user?.id).toBe('6aa5030b1e85b042fcedacbd');
    expect(req.user?.isGuest).toBe(true);

    // Authorization does not. Before this change the handler ran, and an
    // anonymous caller could approve or deny any pending registration.
    expect(reachedHandler).toBe(false);
    expect(res.statusCode).toBe(403);

    resetSigningKeys();
  });
});
