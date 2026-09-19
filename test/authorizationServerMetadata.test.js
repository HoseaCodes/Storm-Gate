import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import express from 'express';
import wellKnownRouter from '../src/routes/wellKnown.js';
import { resetSigningKeys } from '../src/utils/signingKeys.js';
import { snapshotEnv, restoreEnv } from './helpers.js';

let env;
let server;
let baseUrl;

beforeEach(async () => {
  env = snapshotEnv();
  process.env.JWT_ISSUER = 'https://auth.example.com';
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

async function metadata() {
  const res = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
  return { status: res.status, body: await res.json() };
}

/*
RFC 8414 metadata.

Written because clients refuse to proceed without it: ChatGPT rejects an
authorization server whose metadata does not advertise S256, and correctly so —
a client cannot otherwise know that the code challenge it sends will be honoured
rather than ignored.

Each assertion here is a claim about behaviour that exists elsewhere in this
service. A document that advertises something unimplemented is worse than no
document, because a client will act on it.
*/
describe('/.well-known/oauth-authorization-server', () => {
  it('advertises PKCE with S256, and only S256', async () => {
    const res = await metadata();

    expect(res.status).toBe(200);
    expect(res.body.code_challenge_methods_supported).toEqual(['S256']);
    // `plain` is refused by isSupportedChallengeMethod, so advertising it would
    // invite a client to send something this server rejects.
    expect(res.body.code_challenge_methods_supported).not.toContain('plain');
  });

  it('names the endpoints a client would otherwise have to be told', async () => {
    const res = await metadata();

    expect(res.body.issuer).toBe('https://auth.example.com');
    expect(res.body.authorization_endpoint).toBe('https://auth.example.com/oauth/authorize');
    expect(res.body.token_endpoint).toBe('https://auth.example.com/oauth/token');
    expect(res.body.jwks_uri).toBe('https://auth.example.com/.well-known/jwks.json');
  });

  it('advertises the code flow, not the implicit flow', async () => {
    const res = await metadata();

    expect(res.body.response_types_supported).toEqual(['code']);
    expect(res.body.grant_types_supported).toContain('authorization_code');
    expect(res.body.grant_types_supported).toContain('refresh_token');
  });

  it('omits a registration endpoint, because there is none', async () => {
    // Advertising one would turn a clear "not supported" into a failed request
    // against a 404.
    const res = await metadata();
    expect(res.body.registration_endpoint).toBeUndefined();
  });

  it('needs no credential — a client reads it before it has one', async () => {
    const res = await metadata();
    expect(res.status).toBe(200);
  });

  it('lists the scopes the delegated surface actually uses', async () => {
    const res = await metadata();
    expect(res.body.scopes_supported).toEqual([
      'training:read', 'workouts:read', 'workouts:write',
    ]);
  });
});
