// `enhancedVerifyJWT` guards the OIDC and admin-approval routes and accepts
// BOTH Storm-Gate-issued tokens and Azure AD tokens. It gained an RS256 path on
// 2026-09-12; before that, flipping JWT_SIGNING_ALG=RS256 broke every route it
// guards, because our own tokens were looked up in Azure's key set.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { makeKeypair, runMiddleware, snapshotEnv, restoreEnv } from './helpers.js';
import { resetSigningKeys } from '../src/utils/signingKeys.js';
import enhancedVerifyJWT from '../src/utils/enhancedAuth.js';

const SECRET = 'test-hs-secret';
let env;
let kp;
let realFetch;

beforeEach(() => {
  env = snapshotEnv();
  kp = makeKeypair();
  process.env.ACCESS_TOKEN_SECRET = SECRET;
  process.env.TENANT_ID = 'test-tenant';
  delete process.env.JWT_SIGNING_ALG;
  delete process.env.JWT_PRIVATE_KEY;
  delete process.env.JWT_PUBLIC_KEY;
  delete process.env.JWT_ISSUER;
  resetSigningKeys();

  // Nothing in this suite may reach Azure. Default to an empty key set so a
  // token that legitimately falls through resolves deterministically.
  realFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ keys: [] }) }));
});

afterEach(() => {
  globalThis.fetch = realFetch;
  restoreEnv(env);
  resetSigningKeys();
});

function enableRs256({ issuer } = {}) {
  process.env.JWT_SIGNING_ALG = 'RS256';
  process.env.JWT_PRIVATE_KEY = kp.privateKey;
  if (issuer) process.env.JWT_ISSUER = issuer;
  resetSigningKeys();
}

const bearer = (t) => `Bearer ${t}`;

describe('enhancedVerifyJWT — HS256 default (unchanged)', () => {
  it('accepts an internally-issued token', async () => {
    const token = jwt.sign({ id: 'u1', role: 'admin' }, SECRET, { expiresIn: '1h' });
    const { req, nextCalled } = await runMiddleware(enhancedVerifyJWT, bearer(token));
    expect(nextCalled).toBe(true);
    expect(req.user).toMatchObject({ id: 'u1', role: 'admin' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects a missing Authorization header', async () => {
    const { res, nextCalled } = await runMiddleware(enhancedVerifyJWT, undefined);
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('requires the Bearer prefix (unlike the `auth` middleware)', async () => {
    const token = jwt.sign({ id: 'u1' }, SECRET, { expiresIn: '1h' });
    const { res, nextCalled } = await runMiddleware(enhancedVerifyJWT, token);
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('rejects a token signed with the wrong secret', async () => {
    const token = jwt.sign({ id: 'attacker' }, 'wrong-secret');
    const { res, nextCalled } = await runMiddleware(enhancedVerifyJWT, bearer(token));
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('rejects HS512 signed with the shared secret (algorithms are pinned)', async () => {
    const token = jwt.sign({ id: 'u1' }, SECRET, { algorithm: 'HS512' });
    const { res, nextCalled } = await runMiddleware(enhancedVerifyJWT, bearer(token));
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('falls through when a valid token carries no id claim', async () => {
    const token = jwt.sign({ sub: 'no-id-here' }, SECRET, { expiresIn: '1h' });
    const { res, nextCalled } = await runMiddleware(enhancedVerifyJWT, bearer(token));
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });
});

describe('enhancedVerifyJWT — RS256 (the fix)', () => {
  it('accepts a Storm-Gate RS256 token', async () => {
    enableRs256();
    const token = jwt.sign({ id: 'u2', role: 'admin' }, kp.privateKey, {
      algorithm: 'RS256', keyid: kp.kid, expiresIn: '1h',
    });
    const { req, res, nextCalled } = await runMiddleware(enhancedVerifyJWT, bearer(token));
    expect(nextCalled).toBe(true);
    expect(req.user).toMatchObject({ id: 'u2', role: 'admin' });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('never consults Azure for a kid we publish', async () => {
    enableRs256();
    const token = jwt.sign({ id: 'u2' }, kp.privateKey, {
      algorithm: 'RS256', keyid: kp.kid, expiresIn: '1h',
    });
    await runMiddleware(enhancedVerifyJWT, bearer(token));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('enforces the configured issuer', async () => {
    enableRs256({ issuer: 'https://auth.test' });
    const token = jwt.sign({ id: 'attacker' }, kp.privateKey, {
      algorithm: 'RS256', keyid: kp.kid, issuer: 'https://evil.test', expiresIn: '1h',
    });
    const { res, nextCalled } = await runMiddleware(enhancedVerifyJWT, bearer(token));
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('rejects an expired RS256 token', async () => {
    enableRs256();
    const token = jwt.sign({ id: 'u2' }, kp.privateKey, {
      algorithm: 'RS256', keyid: kp.kid, expiresIn: '-1s',
    });
    const { res, nextCalled } = await runMiddleware(enhancedVerifyJWT, bearer(token));
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('still accepts HS256 tokens issued before the flip (drain window)', async () => {
    const preFlip = jwt.sign({ id: 'legacy' }, SECRET, { expiresIn: '1h' });
    enableRs256();
    const { req, nextCalled } = await runMiddleware(enhancedVerifyJWT, bearer(preFlip));
    expect(nextCalled).toBe(true);
    expect(req.user).toMatchObject({ id: 'legacy' });
  });
});

// Publishing a public key makes this reachable: HMAC-sign a token using the
// published RSA public key as the shared secret.
describe('enhancedVerifyJWT — algorithm confusion', () => {
  it('rejects a token HS256-signed with the published public key', async () => {
    enableRs256();
    const forged = jwt.sign({ id: 'attacker', role: 'admin' }, kp.publicKey, {
      algorithm: 'HS256', keyid: kp.kid, expiresIn: '1h',
    });
    const { res, nextCalled } = await runMiddleware(enhancedVerifyJWT, bearer(forged));
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('rejects an RS256 token claiming our kid but signed by another key', async () => {
    enableRs256();
    const other = makeKeypair();
    const forged = jwt.sign({ id: 'attacker' }, other.privateKey, {
      algorithm: 'RS256', keyid: kp.kid, expiresIn: '1h',
    });
    const { res, nextCalled } = await runMiddleware(enhancedVerifyJWT, bearer(forged));
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });
});
