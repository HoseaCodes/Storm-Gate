// Integration coverage for the open-redirect fix in the OIDC login controller.
//
// The unit tests in redirectAllowlist.test.js cover the predicate. These cover
// the wiring: that the controller rejects before it does anything expensive,
// and that a rejection is a flat 400 rather than a redirect.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import { snapshotEnv, restoreEnv } from './helpers.js';
// Imported once at module scope: re-importing per test re-runs src/models/*.js,
// and mongoose refuses to compile the same model name twice.
import authController from '../src/controllers/ext-auth.js';

let env;
let server;
let baseUrl;

// Stub the OIDC layer so this test never reaches Azure AD. If a rejection ever
// regresses to happen *after* discovery, initializeOIDCConfig would run and
// this spy would record it -- which is precisely what we assert against.
const discoveryCalls = { count: 0 };

// The login state store is MongoDB-backed now. This file is about redirect
// validation, not persistence, so it is stubbed -- without it the success-path
// tests would hang on a model call with no database behind it.
vi.mock('../src/utils/oidcSessionStore.js', () => ({
  createAuthSession: vi.fn(async () => {}),
  consumeAuthSession: vi.fn(async () => null),
  discardAuthSession: vi.fn(async () => {}),
  storeRefreshToken: vi.fn(async () => {}),
  isCurrentRefreshToken: vi.fn(async () => false),
  invalidateRefreshToken: vi.fn(async () => {}),
}));

vi.mock('openid-client', () => ({
  discovery: vi.fn(async () => {
    discoveryCalls.count += 1;
    return {};
  }),
  randomState: () => 'test-state',
  randomPKCECodeVerifier: () => 'test-verifier',
  calculatePKCECodeChallenge: async () => 'test-challenge',
  buildAuthorizationUrl: () => new URL('https://login.microsoftonline.com/authorize'),
  authorizationCodeGrant: vi.fn(),
}));

beforeEach(async () => {
  env = snapshotEnv();
  process.env.OIDC_ALLOWED_RETURN_ORIGINS = 'https://www.manifestathletics.com';
  process.env.TENANT_ID = 'test-tenant';
  process.env.CLIENT_ID = 'test-client';
  process.env.CLIENT_SECRET = 'test-secret';
  discoveryCalls.count = 0;

  const app = express();
  app.get('/login', authController.initiateLogin);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  restoreEnv(env);
  await new Promise((resolve) => server.close(resolve));
});

describe('GET /login — return_url validation', () => {
  it('rejects an attacker-controlled return_url with 400', async () => {
    const res = await fetch(
      `${baseUrl}/login?return_url=${encodeURIComponent('https://attacker.example')}`,
      { redirect: 'manual' },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid return_url');
  });

  it('rejects before contacting the identity provider', async () => {
    await fetch(`${baseUrl}/login?return_url=${encodeURIComponent('https://attacker.example')}`, {
      redirect: 'manual',
    });
    // A crafted link must not even cost an IdP round trip, and must not
    // allocate PKCE state that an attacker could then try to race.
    expect(discoveryCalls.count).toBe(0);
  });

  it('rejects a suffix-extended lookalike host', async () => {
    const res = await fetch(
      `${baseUrl}/login?return_url=${encodeURIComponent('https://www.manifestathletics.com.attacker.test')}`,
      { redirect: 'manual' },
    );
    expect(res.status).toBe(400);
  });

  it('proceeds to the IdP for an allowlisted return_url', async () => {
    const res = await fetch(
      `${baseUrl}/login?return_url=${encodeURIComponent('https://www.manifestathletics.com/dashboard')}`,
      { redirect: 'manual' },
    );
    expect(res.status).toBe(302);
    expect(discoveryCalls.count).toBe(1);
  });

  it('proceeds when no return_url is supplied at all', async () => {
    const res = await fetch(`${baseUrl}/login`, { redirect: 'manual' });
    expect(res.status).toBe(302);
  });
});
