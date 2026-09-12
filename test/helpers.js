import crypto from 'crypto';
import { vi } from 'vitest';

/** An RSA keypair plus the public JWK and the kid Storm-Gate will derive for it. */
export function makeKeypair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const jwk = crypto.createPublicKey(publicKey).export({ format: 'jwk' });
  // Must match the RFC 7638 thumbprint computed in src/utils/signingKeys.js.
  const kid = crypto
    .createHash('sha256')
    .update(JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n }))
    .digest('base64url');
  return { privateKey, publicKey, kid };
}

export function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = vi.fn((code) => { res.statusCode = code; return res; });
  res.json = vi.fn((body) => { res.body = body; return res; });
  return res;
}

export function mockReq(authHeader) {
  return {
    headers: { authorization: authHeader },
    header(name) {
      return name.toLowerCase() === 'authorization' ? authHeader : undefined;
    },
  };
}

/**
 * Drive a callback-style Express middleware to completion.
 * Resolves once next() fires or the middleware responds.
 */
export function runMiddleware(middleware, authHeader) {
  return new Promise((resolve) => {
    const req = mockReq(authHeader);
    const res = mockRes();
    let settled = false;
    const done = (nextCalled) => {
      if (settled) return;
      settled = true;
      resolve({ req, res, nextCalled });
    };

    const originalJson = res.json;
    res.json = vi.fn((body) => {
      const out = originalJson(body);
      done(false);
      return out;
    });

    Promise.resolve(middleware(req, res, () => done(true))).catch(() => done(false));
  });
}

/** Env keys this suite mutates, restored between tests. */
export const JWT_ENV_KEYS = [
  'JWT_SIGNING_ALG',
  'JWT_PRIVATE_KEY',
  'JWT_PUBLIC_KEY',
  'JWT_PREVIOUS_PUBLIC_KEYS',
  'JWT_ISSUER',
  'ACCESS_TOKEN_SECRET',
];

export function snapshotEnv() {
  return Object.fromEntries(JWT_ENV_KEYS.map((k) => [k, process.env[k]]));
}

export function restoreEnv(snapshot) {
  for (const key of JWT_ENV_KEYS) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
}
