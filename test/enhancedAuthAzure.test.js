// Azure AD fall-through for `enhancedVerifyJWT`, in its own file on purpose.
//
// The Azure key set is cached in module scope for an hour once populated, so a
// single fall-through anywhere in a file hides the network call from every test
// after it. Vitest isolates modules per file, which gives these tests a clean
// cache. (`vi.resetModules()` is not an option here — re-importing the
// middleware re-registers the mongoose `User` model and throws.)
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
  process.env.JWT_SIGNING_ALG = 'RS256';
  process.env.JWT_PRIVATE_KEY = kp.privateKey;
  delete process.env.JWT_ISSUER;
  resetSigningKeys();

  realFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ keys: [] }) }));
});

afterEach(() => {
  globalThis.fetch = realFetch;
  restoreEnv(env);
  resetSigningKeys();
});

const bearer = (t) => `Bearer ${t}`;

describe('enhancedVerifyJWT — Azure AD path is untouched by the RS256 change', () => {
  it('routes a foreign RS256 kid to the Azure key set', async () => {
    const azure = makeKeypair();
    const token = jwt.sign({ sub: 'azure-user' }, azure.privateKey, {
      algorithm: 'RS256', keyid: 'azure-kid', expiresIn: '1h',
    });

    const { res, nextCalled } = await runMiddleware(enhancedVerifyJWT, bearer(token));

    expect(globalThis.fetch).toHaveBeenCalledOnce();
    expect(globalThis.fetch.mock.calls[0][0]).toContain('login.microsoftonline.com');
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401); // stub serves an empty key set
  });

  it('rejects a token with no kid before reaching the network', async () => {
    const token = jwt.sign({ sub: 'no-kid' }, 'someone-elses-secret');
    const { res, nextCalled } = await runMiddleware(enhancedVerifyJWT, bearer(token));
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });
});
