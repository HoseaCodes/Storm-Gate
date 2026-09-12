// Golden contract test for the `auth` middleware's HTTP surface.
//
// These exact (status, msg) pairs are what consuming apps see. They were
// verified identical to the pre-RS256 implementation across this input matrix,
// with two deliberate exceptions marked below. Changing any expectation here
// is a breaking change for consumers -- update consumers first.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { runMiddleware, snapshotEnv, restoreEnv } from './helpers.js';
import { resetSigningKeys } from '../src/utils/signingKeys.js';
import auth from '../src/utils/auth.js';

const SECRET = 'shared-secret';
let env;
let foreign;

beforeEach(() => {
  env = snapshotEnv();
  process.env.ACCESS_TOKEN_SECRET = SECRET;
  delete process.env.JWT_SIGNING_ALG;
  delete process.env.JWT_PRIVATE_KEY;
  delete process.env.JWT_PUBLIC_KEY;
  delete process.env.JWT_ISSUER;
  resetSigningKeys();
  foreign = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
});

afterEach(() => {
  restoreEnv(env);
  resetSigningKeys();
});

describe('auth middleware — preserved contract (identical to pre-RS256)', () => {
  const preserved = [
    ['valid HS256 with Bearer', () => `Bearer ${jwt.sign({ id: 'u1' }, SECRET, { expiresIn: '1h' })}`, 'next'],
    ['valid HS256 raw',         () => jwt.sign({ id: 'u1' }, SECRET, { expiresIn: '1h' }), 'next'],
    ['HS256 without expiry',    () => jwt.sign({ id: 'u1' }, SECRET), 'next'],
    ['HS256 with extra claims', () => jwt.sign({ id: 'u1', role: 1 }, SECRET, { expiresIn: '1h' }), 'next'],
    ['missing header',          () => undefined, [400, 'Invalid Authentication - no token']],
    ['empty header',            () => '', [400, 'Invalid Authentication - no token']],
    ['Bearer with no token',    () => 'Bearer ', [400, 'Invalid Authentication - invalid token']],
    ['wrong secret',            () => `Bearer ${jwt.sign({ id: 'x' }, 'nope')}`, [400, 'Invalid Authentication - invalid token']],
    ['malformed token',         () => 'Bearer not-a-jwt', [400, 'Invalid Authentication - invalid token']],
    ['not-yet-valid token',     () => `Bearer ${jwt.sign({ id: 'u1' }, SECRET, { notBefore: '1h' })}`, [400, 'Invalid Authentication - invalid token']],
    ['alg=none',                () => `Bearer ${jwt.sign({ id: 'x' }, '', { algorithm: 'none' })}`, [400, 'Invalid Authentication - invalid token']],
  ];

  it.each(preserved)('%s', async (_name, build, expected) => {
    const { res, nextCalled } = await runMiddleware(auth, build());
    if (expected === 'next') {
      expect(nextCalled).toBe(true);
      expect(res.status).not.toHaveBeenCalled();
    } else {
      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(expected[0]);
      expect(res.body.msg).toBe(expected[1]);
    }
  });

  it('reports an expired token with its own message', async () => {
    const { res, nextCalled } = await runMiddleware(
      auth, `Bearer ${jwt.sign({ id: 'u1' }, SECRET, { expiresIn: '-1s' })}`,
    );
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(400);
    expect(res.body.msg).toBe('Token Expired Error');
  });
});

// The only two behaviour changes. Both are deliberate and neither is reachable
// by a token Storm-Gate has ever issued.
describe('auth middleware — intentional divergences from pre-RS256', () => {
  // Storm-Gate has always signed HS256. These were previously accepted only
  // because `jwt.verify` was called with no `algorithms` restriction -- the
  // same gap that makes an RS256->HS256 confusion forgery possible once a
  // public key is published.
  it.each(['HS384', 'HS512'])(
    'now rejects %s signed with the shared secret (was accepted)',
    async (algorithm) => {
      const token = jwt.sign({ id: 'u1' }, SECRET, { algorithm });
      const { res, nextCalled } = await runMiddleware(auth, `Bearer ${token}`);
      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(400);
      expect(res.body.msg).toBe('Invalid Authentication - invalid token');
    },
  );

  // Status code is unchanged (400); only the message is more specific. Azure AD
  // RS256 tokens are handled by `verifyJWT` on different routes, so this path
  // is only reached by a token sent to the wrong endpoint.
  it.each([
    ['with a kid', true],
    ['without a kid', false],
  ])('returns the same 400 for a foreign RS256 token %s', async (_name, withKid) => {
    const token = jwt.sign({ id: 'x' }, foreign.privateKey, {
      algorithm: 'RS256',
      ...(withKid ? { keyid: 'azure-kid' } : {}),
      expiresIn: '1h',
    });
    const { res, nextCalled } = await runMiddleware(auth, `Bearer ${token}`);
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(400); // unchanged
    expect(res.body.msg).toBe('Invalid Authentication - unknown signing key');
  });
});

describe('token issuance contract', () => {
  it('issues access and refresh tokens unchanged under default config', async () => {
    process.env.REFRESH_TOKEN_SECRET = 'refresh-secret';
    const { createAccessToken, createRefreshToken } = await import('../src/utils/auth.js');

    const access = jwt.decode(createAccessToken({ id: 'u1' }), { complete: true });
    expect(access.header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(Object.keys(access.payload).sort()).toEqual(['exp', 'iat', 'id']);
    expect(access.payload.exp - access.payload.iat).toBe(86400);

    const refresh = jwt.decode(createRefreshToken({ id: 'u1' }), { complete: true });
    expect(refresh.header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(refresh.payload.exp - refresh.payload.iat).toBe(604800);
  });
});
