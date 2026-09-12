import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  makeKeypair,
  runMiddleware,
  snapshotEnv,
  restoreEnv,
} from './helpers.js';
import { resetSigningKeys } from '../src/utils/signingKeys.js';
import auth, { createAccessToken, createRefreshToken } from '../src/utils/auth.js';

const SECRET = 'test-hs-secret';
let env;
let kp;

beforeEach(() => {
  env = snapshotEnv();
  kp = makeKeypair();
  process.env.ACCESS_TOKEN_SECRET = SECRET;
  process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret';
  delete process.env.JWT_SIGNING_ALG;
  delete process.env.JWT_PRIVATE_KEY;
  delete process.env.JWT_PUBLIC_KEY;
  delete process.env.JWT_ISSUER;
  resetSigningKeys();
});

afterEach(() => {
  restoreEnv(env);
  resetSigningKeys();
});

function enableRs256({ issuer } = {}) {
  process.env.JWT_SIGNING_ALG = 'RS256';
  process.env.JWT_PRIVATE_KEY = kp.privateKey;
  if (issuer) process.env.JWT_ISSUER = issuer;
  resetSigningKeys();
}

describe('auth middleware — HS256 (default, unchanged)', () => {
  it('accepts a valid token and populates req.user', async () => {
    const { res, req, nextCalled } = await runMiddleware(
      auth, `Bearer ${createAccessToken({ id: 'u1' })}`,
    );
    expect(nextCalled).toBe(true);
    expect(req.user).toMatchObject({ id: 'u1' });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('accepts a raw token without the Bearer prefix', async () => {
    const { nextCalled } = await runMiddleware(auth, createAccessToken({ id: 'u1' }));
    expect(nextCalled).toBe(true);
  });

  it('rejects a missing Authorization header', async () => {
    const { res, nextCalled } = await runMiddleware(auth, undefined);
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(400);
  });

  it('rejects a token signed with the wrong secret', async () => {
    const token = jwt.sign({ id: 'attacker' }, 'wrong-secret');
    const { res, nextCalled } = await runMiddleware(auth, `Bearer ${token}`);
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(400);
  });

  it('reports an expired token distinctly', async () => {
    const token = jwt.sign({ id: 'u1' }, SECRET, { expiresIn: '-1s' });
    const { res, nextCalled } = await runMiddleware(auth, `Bearer ${token}`);
    expect(nextCalled).toBe(false);
    expect(res.body.msg).toMatch(/Token Expired/i);
  });

  it('rejects a non-HS256 symmetric algorithm', async () => {
    const token = jwt.sign({ id: 'u1' }, SECRET, { algorithm: 'HS512' });
    const { res, nextCalled } = await runMiddleware(auth, `Bearer ${token}`);
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(400);
  });

  it('rejects an unsigned (alg=none) token', async () => {
    const token = jwt.sign({ id: 'attacker' }, '', { algorithm: 'none' });
    const { res, nextCalled } = await runMiddleware(auth, `Bearer ${token}`);
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(400);
  });

  it('rejects a structurally invalid token', async () => {
    const { res, nextCalled } = await runMiddleware(auth, 'Bearer not-a-jwt');
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(400);
  });
});

describe('auth middleware — RS256', () => {
  it('accepts a token signed by the active key', async () => {
    enableRs256();
    const { req, nextCalled } = await runMiddleware(
      auth, `Bearer ${createAccessToken({ id: 'u2' })}`,
    );
    expect(nextCalled).toBe(true);
    expect(req.user).toMatchObject({ id: 'u2' });
  });

  it('enforces the configured issuer', async () => {
    enableRs256({ issuer: 'https://auth.test' });
    const forged = jwt.sign({ id: 'attacker' }, kp.privateKey, {
      algorithm: 'RS256', keyid: kp.kid, issuer: 'https://evil.test', expiresIn: '1h',
    });
    const { res, nextCalled } = await runMiddleware(auth, `Bearer ${forged}`);
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(400);
  });

  it('rejects a token whose kid is not published', async () => {
    enableRs256();
    const token = jwt.sign({ id: 'attacker' }, kp.privateKey, {
      algorithm: 'RS256', keyid: 'unknown-kid', expiresIn: '1h',
    });
    const { res, nextCalled } = await runMiddleware(auth, `Bearer ${token}`);
    expect(nextCalled).toBe(false);
    expect(res.body.msg).toMatch(/unknown signing key/i);
  });

  it('rejects an RS256 token carrying no kid', async () => {
    enableRs256();
    const token = jwt.sign({ id: 'attacker' }, kp.privateKey, {
      algorithm: 'RS256', expiresIn: '1h',
    });
    const { res, nextCalled } = await runMiddleware(auth, `Bearer ${token}`);
    expect(nextCalled).toBe(false);
    expect(res.body.msg).toMatch(/unknown signing key/i);
  });

  it('rejects a token claiming our kid but signed by another key', async () => {
    enableRs256();
    const other = makeKeypair();
    const token = jwt.sign({ id: 'attacker' }, other.privateKey, {
      algorithm: 'RS256', keyid: kp.kid, expiresIn: '1h',
    });
    const { res, nextCalled } = await runMiddleware(auth, `Bearer ${token}`);
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(400);
  });
});

describe('auth middleware — migration drain window', () => {
  it('still accepts HS256 tokens issued before the flip', async () => {
    const preFlip = createAccessToken({ id: 'legacy' });
    enableRs256();
    const { req, nextCalled } = await runMiddleware(auth, `Bearer ${preFlip}`);
    expect(nextCalled).toBe(true);
    expect(req.user).toMatchObject({ id: 'legacy' });
  });

  it('still rejects a bad HS256 signature after the flip', async () => {
    enableRs256();
    const token = jwt.sign({ id: 'attacker' }, 'wrong-secret');
    const { res, nextCalled } = await runMiddleware(auth, `Bearer ${token}`);
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(400);
  });
});

// Publishing an RSA public key makes this reachable: an attacker HMAC-signs a
// token using the public key as the shared secret. A verifier that lets the
// token's own `alg` choose the key material accepts it.
describe('auth middleware — algorithm confusion', () => {
  it('rejects a token HS256-signed with the published public key', async () => {
    enableRs256();
    const forged = jwt.sign({ id: 'attacker', role: 1 }, kp.publicKey, {
      algorithm: 'HS256', keyid: kp.kid, expiresIn: '1h',
    });
    const { res, nextCalled } = await runMiddleware(auth, `Bearer ${forged}`);
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(400);
  });

  it('rejects that forgery while HS256 signing is still active', async () => {
    process.env.JWT_PUBLIC_KEY = kp.publicKey;
    resetSigningKeys();
    const forged = jwt.sign({ id: 'attacker', role: 1 }, kp.publicKey, {
      algorithm: 'HS256', keyid: kp.kid, expiresIn: '1h',
    });
    const { res, nextCalled } = await runMiddleware(auth, `Bearer ${forged}`);
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(400);
  });
});

describe('refresh tokens stay symmetric', () => {
  it('signs HS256 against REFRESH_TOKEN_SECRET even when RS256 is enabled', () => {
    enableRs256();
    const token = createRefreshToken({ id: 'u1' });
    expect(jwt.decode(token, { complete: true }).header.alg).toBe('HS256');
    expect(jwt.verify(token, process.env.REFRESH_TOKEN_SECRET)).toMatchObject({ id: 'u1' });
  });
});
