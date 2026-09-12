import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { makeKeypair, snapshotEnv, restoreEnv } from './helpers.js';
import { resetSigningKeys, signAccessToken } from '../src/utils/signingKeys.js';
import wellKnownRouter from '../src/routes/wellKnown.js';

let env;
let kp;
let server;
let baseUrl;

beforeEach(async () => {
  env = snapshotEnv();
  kp = makeKeypair();
  process.env.ACCESS_TOKEN_SECRET = 'test-hs-secret';
  delete process.env.JWT_SIGNING_ALG;
  delete process.env.JWT_PRIVATE_KEY;
  delete process.env.JWT_PUBLIC_KEY;
  delete process.env.JWT_ISSUER;
  resetSigningKeys();

  const app = express();
  app.use(wellKnownRouter);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  restoreEnv(env);
  resetSigningKeys();
  await new Promise((resolve) => server.close(resolve));
});

function enableRs256({ issuer } = {}) {
  process.env.JWT_SIGNING_ALG = 'RS256';
  process.env.JWT_PRIVATE_KEY = kp.privateKey;
  if (issuer) process.env.JWT_ISSUER = issuer;
  resetSigningKeys();
}

describe('GET /.well-known/jwks.json', () => {
  it('serves an empty key set when no key is configured', async () => {
    const res = await fetch(`${baseUrl}/.well-known/jwks.json`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ keys: [] });
  });

  it('is reachable without authentication', async () => {
    enableRs256();
    const res = await fetch(`${baseUrl}/.well-known/jwks.json`);
    expect(res.status).toBe(200);
  });

  it('publishes the active key with a resolvable kid', async () => {
    enableRs256();
    const { keys } = await (await fetch(`${baseUrl}/.well-known/jwks.json`)).json();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ kty: 'RSA', alg: 'RS256', use: 'sig', kid: kp.kid });
  });

  it('publishes a key that actually verifies an issued token', async () => {
    enableRs256();
    const token = signAccessToken({ id: 'u1' }, { expiresIn: '1h' });
    const { keys } = await (await fetch(`${baseUrl}/.well-known/jwks.json`)).json();

    // Exactly what a third-party verifier does: match kid, rebuild the key.
    const header = jwt.decode(token, { complete: true }).header;
    const jwk = keys.find((k) => k.kid === header.kid);
    expect(jwk).toBeDefined();

    const publicKey = (await import('crypto')).createPublicKey({ key: jwk, format: 'jwk' });
    expect(jwt.verify(token, publicKey, { algorithms: ['RS256'] })).toMatchObject({ id: 'u1' });
  });

  it('leaks no private key material', async () => {
    enableRs256();
    const body = await (await fetch(`${baseUrl}/.well-known/jwks.json`)).text();
    for (const field of ['"d"', '"p"', '"q"', '"dp"', '"dq"', '"qi"']) {
      expect(body).not.toContain(field);
    }
    expect(body).not.toContain('PRIVATE KEY');
  });

  it('sets a revalidating cache header so rotations propagate', async () => {
    enableRs256();
    const res = await fetch(`${baseUrl}/.well-known/jwks.json`);
    expect(res.headers.get('cache-control')).toMatch(/max-age=\d+/);
    expect(res.headers.get('cache-control')).toMatch(/must-revalidate/);
  });

  it('publishes retired keys alongside the active one', async () => {
    const retired = makeKeypair();
    process.env.JWT_PREVIOUS_PUBLIC_KEYS = retired.publicKey;
    enableRs256();
    const { keys } = await (await fetch(`${baseUrl}/.well-known/jwks.json`)).json();
    expect(keys.map((k) => k.kid).sort()).toEqual([kp.kid, retired.kid].sort());
  });
});

describe('GET /.well-known/openid-configuration', () => {
  it('advertises the jwks_uri under the configured issuer', async () => {
    enableRs256({ issuer: 'https://auth.test' });
    const doc = await (await fetch(`${baseUrl}/.well-known/openid-configuration`)).json();
    expect(doc.issuer).toBe('https://auth.test');
    expect(doc.jwks_uri).toBe('https://auth.test/.well-known/jwks.json');
    expect(doc.id_token_signing_alg_values_supported).toEqual(['RS256']);
  });

  it('does not double the slash when the issuer has a trailing one', async () => {
    enableRs256({ issuer: 'https://auth.test/' });
    const doc = await (await fetch(`${baseUrl}/.well-known/openid-configuration`)).json();
    expect(doc.jwks_uri).toBe('https://auth.test/.well-known/jwks.json');
  });

  it('falls back to the request host when no issuer is configured', async () => {
    const doc = await (await fetch(`${baseUrl}/.well-known/openid-configuration`)).json();
    expect(doc.issuer).toBe(baseUrl);
    expect(doc.jwks_uri).toBe(`${baseUrl}/.well-known/jwks.json`);
  });

  it('honours proxy forwarding headers', async () => {
    const doc = await (await fetch(`${baseUrl}/.well-known/openid-configuration`, {
      headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'auth.example.com' },
    })).json();
    expect(doc.issuer).toBe('https://auth.example.com');
    expect(doc.jwks_uri).toBe('https://auth.example.com/.well-known/jwks.json');
  });

  it('points at a jwks_uri that actually resolves', async () => {
    enableRs256();
    const doc = await (await fetch(`${baseUrl}/.well-known/openid-configuration`)).json();
    const res = await fetch(doc.jwks_uri);
    expect(res.status).toBe(200);
    expect((await res.json()).keys[0].kid).toBe(kp.kid);
  });
});
