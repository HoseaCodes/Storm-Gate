import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { makeKeypair, snapshotEnv, restoreEnv } from './helpers.js';
import {
  resetSigningKeys,
  isRs256Enabled,
  hasPublishedKeys,
  getJwks,
  getPublicKeyByKid,
  getIssuer,
  signAccessToken,
} from '../src/utils/signingKeys.js';

let env;
let kp;

beforeEach(() => {
  env = snapshotEnv();
  kp = makeKeypair();
  process.env.ACCESS_TOKEN_SECRET = 'test-hs-secret';
  delete process.env.JWT_SIGNING_ALG;
  delete process.env.JWT_PRIVATE_KEY;
  delete process.env.JWT_PUBLIC_KEY;
  delete process.env.JWT_PREVIOUS_PUBLIC_KEYS;
  delete process.env.JWT_ISSUER;
  resetSigningKeys();
});

afterEach(() => {
  restoreEnv(env);
  resetSigningKeys();
});

describe('signingKeys — default (HS256)', () => {
  it('does not enable RS256 without configuration', () => {
    expect(isRs256Enabled()).toBe(false);
    expect(hasPublishedKeys()).toBe(false);
  });

  it('publishes an empty key set', () => {
    expect(getJwks()).toEqual({ keys: [] });
  });

  it('signs HS256 against ACCESS_TOKEN_SECRET', () => {
    const token = signAccessToken({ id: 'u1' }, { expiresIn: '1h' });
    expect(jwt.decode(token, { complete: true }).header.alg).toBe('HS256');
    expect(jwt.verify(token, 'test-hs-secret')).toMatchObject({ id: 'u1' });
  });
});

describe('signingKeys — RS256 enabled', () => {
  beforeEach(() => {
    process.env.JWT_SIGNING_ALG = 'RS256';
    process.env.JWT_PRIVATE_KEY = kp.privateKey;
    resetSigningKeys();
  });

  it('enables RS256 and publishes one key', () => {
    expect(isRs256Enabled()).toBe(true);
    expect(getJwks().keys).toHaveLength(1);
  });

  it('derives the kid as an RFC 7638 thumbprint', () => {
    expect(getJwks().keys[0].kid).toBe(kp.kid);
  });

  it('marks the key for RS256 signature use', () => {
    expect(getJwks().keys[0]).toMatchObject({ kty: 'RSA', alg: 'RS256', use: 'sig' });
  });

  it('never publishes private key material', () => {
    for (const key of getJwks().keys) {
      for (const field of ['d', 'p', 'q', 'dp', 'dq', 'qi']) {
        expect(key).not.toHaveProperty(field);
      }
    }
  });

  it('returns a defensive copy of the key set', () => {
    getJwks().keys[0].kid = 'mutated';
    expect(getJwks().keys[0].kid).toBe(kp.kid);
  });

  it('signs RS256 with a kid the key set resolves', () => {
    const token = signAccessToken({ id: 'u2' }, { expiresIn: '1h' });
    const header = jwt.decode(token, { complete: true }).header;
    expect(header.alg).toBe('RS256');
    expect(header.kid).toBe(kp.kid);
    expect(getPublicKeyByKid(header.kid)).not.toBeNull();
    expect(jwt.verify(token, kp.publicKey, { algorithms: ['RS256'] })).toMatchObject({ id: 'u2' });
  });

  it('stamps the configured issuer', () => {
    process.env.JWT_ISSUER = 'https://auth.test';
    resetSigningKeys();
    const token = signAccessToken({ id: 'u3' }, { expiresIn: '1h' });
    expect(getIssuer()).toBe('https://auth.test');
    expect(jwt.decode(token).iss).toBe('https://auth.test');
  });

  it('returns null for a kid it does not publish', () => {
    expect(getPublicKeyByKid('nope')).toBeNull();
    expect(getPublicKeyByKid(undefined)).toBeNull();
  });
});

describe('signingKeys — key rotation', () => {
  it('keeps retired public keys in the JWKS so old tokens still verify', () => {
    const retired = makeKeypair();
    process.env.JWT_SIGNING_ALG = 'RS256';
    process.env.JWT_PRIVATE_KEY = kp.privateKey;
    process.env.JWT_PREVIOUS_PUBLIC_KEYS = retired.publicKey;
    resetSigningKeys();

    const kids = getJwks().keys.map((k) => k.kid);
    expect(kids).toContain(kp.kid);
    expect(kids).toContain(retired.kid);
    expect(getPublicKeyByKid(retired.kid)).not.toBeNull();
  });

  it('signs with the active key, not a retired one', () => {
    const retired = makeKeypair();
    process.env.JWT_SIGNING_ALG = 'RS256';
    process.env.JWT_PRIVATE_KEY = kp.privateKey;
    process.env.JWT_PREVIOUS_PUBLIC_KEYS = retired.publicKey;
    resetSigningKeys();

    const token = signAccessToken({ id: 'u1' }, { expiresIn: '1h' });
    expect(jwt.decode(token, { complete: true }).header.kid).toBe(kp.kid);
  });

  it('deduplicates a key listed twice', () => {
    process.env.JWT_SIGNING_ALG = 'RS256';
    process.env.JWT_PRIVATE_KEY = kp.privateKey;
    process.env.JWT_PUBLIC_KEY = kp.publicKey;
    process.env.JWT_PREVIOUS_PUBLIC_KEYS = `${kp.publicKey},`;
    resetSigningKeys();
    expect(getJwks().keys).toHaveLength(1);
  });
});

describe('signingKeys — verify-only deployment', () => {
  it('publishes a public key without a signing key and keeps signing HS256', () => {
    process.env.JWT_PUBLIC_KEY = kp.publicKey;
    resetSigningKeys();

    expect(isRs256Enabled()).toBe(false);
    expect(hasPublishedKeys()).toBe(true);
    expect(getJwks().keys[0].kid).toBe(kp.kid);
    // Consumers can cut over to JWKS before the issuer flips.
    expect(jwt.decode(signAccessToken({ id: 'u1' }), { complete: true }).header.alg).toBe('HS256');
  });
});

describe('signingKeys — env encodings', () => {
  it.each([
    ['raw PEM', (pem) => pem],
    ['base64 PEM', (pem) => Buffer.from(pem).toString('base64')],
    ['escaped newlines', (pem) => pem.replace(/\n/g, '\\n')],
    ['surrounding whitespace', (pem) => `\n  ${pem}  \n`],
  ])('accepts %s and derives the same kid', (_label, encode) => {
    process.env.JWT_SIGNING_ALG = 'RS256';
    process.env.JWT_PRIVATE_KEY = encode(kp.privateKey);
    resetSigningKeys();
    expect(getJwks().keys[0].kid).toBe(kp.kid);
  });
});

describe('signingKeys — misconfiguration fails at boot', () => {
  it('throws when RS256 is requested with no private key', () => {
    process.env.JWT_SIGNING_ALG = 'RS256';
    resetSigningKeys();
    expect(() => isRs256Enabled()).toThrow(/requires JWT_PRIVATE_KEY/);
  });

  it('distinguishes a malformed key from a missing one', () => {
    process.env.JWT_SIGNING_ALG = 'RS256';
    process.env.JWT_PRIVATE_KEY = 'not-a-pem';
    resetSigningKeys();
    expect(() => isRs256Enabled()).toThrow(/JWT_PRIVATE_KEY is set but is not a valid PEM/);
  });

  it('rejects a non-RSA signing key', () => {
    const { privateKey } = crypto.generateKeyPairSync('ed25519', {
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    process.env.JWT_SIGNING_ALG = 'RS256';
    process.env.JWT_PRIVATE_KEY = privateKey;
    resetSigningKeys();
    expect(() => isRs256Enabled()).toThrow(/must be an RSA key/);
  });

  it('rejects a malformed retired public key', () => {
    process.env.JWT_SIGNING_ALG = 'RS256';
    process.env.JWT_PRIVATE_KEY = kp.privateKey;
    process.env.JWT_PREVIOUS_PUBLIC_KEYS = '-----BEGIN PUBLIC KEY-----\ngarbage\n-----END PUBLIC KEY-----';
    resetSigningKeys();
    expect(() => getJwks()).toThrow(/Invalid RSA public key/);
  });
});
