import { describe, expect, it, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { createRequireAuth } from '../src/requireAuth.js';

const SECRET = 'test-secret-do-not-use-in-prod';
const JWKS_URI = 'https://auth.test/.well-known/jwks.json';

function makeKeypair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const jwk = crypto.createPublicKey(publicKey).export({ format: 'jwk' });
  const kid = crypto
    .createHash('sha256')
    .update(JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n }))
    .digest('base64url');
  return { privateKey, publicKey, jwk: { ...jwk, kid, alg: 'RS256', use: 'sig' }, kid };
}

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function mockReq(authHeader) {
  return {
    headers: { authorization: authHeader },
    header(name) {
      return this.headers[name.toLowerCase()];
    },
  };
}

// A fetch stub that serves a fixed key set and counts calls.
function jwksFetch(keys) {
  const impl = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ keys: typeof keys === 'function' ? keys() : keys }),
  }));
  return impl;
}

let kp;
beforeEach(() => {
  kp = makeKeypair();
});

describe('createRequireAuth — RS256 via JWKS', () => {
  it('does not require a secret when a jwksUri is given', () => {
    expect(() => createRequireAuth({ jwksUri: JWKS_URI })).not.toThrow();
  });

  it('verifies an RS256 token against the published key set', async () => {
    const requireAuth = createRequireAuth({
      jwksUri: JWKS_URI,
      fetchImpl: jwksFetch([kp.jwk]),
    });
    const token = jwt.sign({ id: 'user-1' }, kp.privateKey, {
      algorithm: 'RS256',
      keyid: kp.kid,
      expiresIn: '1h',
    });
    const req = mockReq(`Bearer ${token}`);
    const res = mockRes();
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.user).toMatchObject({ id: 'user-1' });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('still accepts HS256 tokens while a secret is configured (migration window)', async () => {
    const requireAuth = createRequireAuth({
      secret: SECRET,
      jwksUri: JWKS_URI,
      fetchImpl: jwksFetch([kp.jwk]),
    });
    const token = jwt.sign({ id: 'legacy-user' }, SECRET, { expiresIn: '1h' });
    const req = mockReq(`Bearer ${token}`);
    const res = mockRes();
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.user).toMatchObject({ id: 'legacy-user' });
  });

  it('rejects HS256 tokens once the secret is dropped', async () => {
    const requireAuth = createRequireAuth({
      jwksUri: JWKS_URI,
      fetchImpl: jwksFetch([kp.jwk]),
    });
    const token = jwt.sign({ id: 'legacy-user' }, SECRET, { expiresIn: '1h' });
    const req = mockReq(`Bearer ${token}`);
    const res = mockRes();
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  // The attack this whole design has to survive: once the RSA public key is
  // published, an attacker can HMAC-sign a token using that public key as the
  // shared secret. A verifier that lets the token's own `alg` pick the key
  // material will accept it.
  it('rejects a token HS256-signed with the published public key (alg confusion)', async () => {
    const forged = jwt.sign({ id: 'attacker', role: 1 }, kp.publicKey, {
      algorithm: 'HS256',
      keyid: kp.kid,
      expiresIn: '1h',
    });

    for (const options of [
      { jwksUri: JWKS_URI, fetchImpl: jwksFetch([kp.jwk]) },
      { secret: SECRET, jwksUri: JWKS_URI, fetchImpl: jwksFetch([kp.jwk]) },
    ]) {
      const requireAuth = createRequireAuth(options);
      const req = mockReq(`Bearer ${forged}`);
      const res = mockRes();
      const next = vi.fn();

      await requireAuth(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    }
  });

  it('rejects an RS256 token signed by a key we do not publish', async () => {
    const other = makeKeypair();
    const requireAuth = createRequireAuth({
      jwksUri: JWKS_URI,
      fetchImpl: jwksFetch([kp.jwk]),
    });
    const token = jwt.sign({ id: 'attacker' }, other.privateKey, {
      algorithm: 'RS256',
      keyid: other.kid,
      expiresIn: '1h',
    });
    const req = mockReq(`Bearer ${token}`);
    const res = mockRes();
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'UnknownSigningKey' }),
    );
  });

  it('rejects an RS256 token whose kid matches but signature does not', async () => {
    const other = makeKeypair();
    const requireAuth = createRequireAuth({
      jwksUri: JWKS_URI,
      fetchImpl: jwksFetch([kp.jwk]),
    });
    // Signed by the wrong private key, but claiming our kid.
    const token = jwt.sign({ id: 'attacker' }, other.privateKey, {
      algorithm: 'RS256',
      keyid: kp.kid,
      expiresIn: '1h',
    });
    const req = mockReq(`Bearer ${token}`);
    const res = mockRes();
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 with TokenExpiredError code on an expired RS256 token', async () => {
    const requireAuth = createRequireAuth({
      jwksUri: JWKS_URI,
      fetchImpl: jwksFetch([kp.jwk]),
    });
    const token = jwt.sign({ id: 'user-1' }, kp.privateKey, {
      algorithm: 'RS256',
      keyid: kp.kid,
      expiresIn: '-1s',
    });
    const req = mockReq(`Bearer ${token}`);
    const res = mockRes();
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'TokenExpiredError', msg: 'Token expired' }),
    );
  });

  it('enforces issuer when configured', async () => {
    const requireAuth = createRequireAuth({
      jwksUri: JWKS_URI,
      issuer: 'https://auth.test',
      fetchImpl: jwksFetch([kp.jwk]),
    });
    const token = jwt.sign({ id: 'user-1' }, kp.privateKey, {
      algorithm: 'RS256',
      keyid: kp.kid,
      issuer: 'https://evil.test',
      expiresIn: '1h',
    });
    const req = mockReq(`Bearer ${token}`);
    const res = mockRes();
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('caches the key set across requests', async () => {
    const fetchImpl = jwksFetch([kp.jwk]);
    const requireAuth = createRequireAuth({ jwksUri: JWKS_URI, fetchImpl });
    const token = jwt.sign({ id: 'user-1' }, kp.privateKey, {
      algorithm: 'RS256',
      keyid: kp.kid,
      expiresIn: '1h',
    });

    for (let i = 0; i < 3; i += 1) {
      const next = vi.fn();
      await requireAuth(mockReq(`Bearer ${token}`), mockRes(), next);
      expect(next).toHaveBeenCalledOnce();
    }

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('picks up a rotated key on an unknown kid', async () => {
    let published = [kp.jwk];
    const fetchImpl = jwksFetch(() => published);
    const requireAuth = createRequireAuth({
      jwksUri: JWKS_URI,
      fetchImpl,
      minRefreshMs: 0,
    });

    // Warm the cache with the original key.
    const first = jwt.sign({ id: 'user-1' }, kp.privateKey, {
      algorithm: 'RS256', keyid: kp.kid, expiresIn: '1h',
    });
    await requireAuth(mockReq(`Bearer ${first}`), mockRes(), vi.fn());

    // Rotate: a new key appears, and a token signed by it arrives.
    const rotated = makeKeypair();
    published = [kp.jwk, rotated.jwk];
    const token = jwt.sign({ id: 'user-2' }, rotated.privateKey, {
      algorithm: 'RS256', keyid: rotated.kid, expiresIn: '1h',
    });
    const req = mockReq(`Bearer ${token}`);
    const next = vi.fn();

    await requireAuth(req, mockRes(), next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.user).toMatchObject({ id: 'user-2' });
  });

  it('returns 503, not 401, when the key set cannot be fetched', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const requireAuth = createRequireAuth({ jwksUri: JWKS_URI, fetchImpl });
    const token = jwt.sign({ id: 'user-1' }, kp.privateKey, {
      algorithm: 'RS256', keyid: kp.kid, expiresIn: '1h',
    });
    const res = mockRes();
    const next = vi.fn();

    await requireAuth(mockReq(`Bearer ${token}`), res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  it('serves cached keys when a later refresh fails', async () => {
    let fail = false;
    const fetchImpl = vi.fn(async () => {
      if (fail) throw new Error('ECONNREFUSED');
      return { ok: true, status: 200, json: async () => ({ keys: [kp.jwk] }) };
    });
    const requireAuth = createRequireAuth({
      jwksUri: JWKS_URI,
      fetchImpl,
      cacheTtlMs: 0, // every request re-checks
    });
    const token = jwt.sign({ id: 'user-1' }, kp.privateKey, {
      algorithm: 'RS256', keyid: kp.kid, expiresIn: '1h',
    });

    await requireAuth(mockReq(`Bearer ${token}`), mockRes(), vi.fn());

    fail = true;
    const next = vi.fn();
    await requireAuth(mockReq(`Bearer ${token}`), mockRes(), next);

    expect(next).toHaveBeenCalledOnce();
  });
});
