/**
 * RFC 7591 Dynamic Client Registration.
 *
 * Open by design: no credential is required to call it. What that grants is
 * narrow — the ability to create a client record that may *ask* an athlete for
 * consent — and the tests here are mostly about keeping it narrow. The scopes a
 * caller may request, the audience its tokens carry, and the id it is known by
 * are all decided here, not by the request.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import { snapshotEnv, restoreEnv } from './helpers.js';

const created = [];

vi.mock('../src/models/serviceClient.js', () => ({
  default: {
    create: vi.fn(async (doc) => {
      created.push(doc);
      return doc;
    }),
  },
}));

let env;
let server;
let baseUrl;

beforeEach(async () => {
  env = snapshotEnv();
  created.length = 0;

  const { default: oauthRouter } = await import('../src/routes/oauth.js');
  const app = express();
  app.use(express.json());
  app.use('/oauth', oauthRouter);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  restoreEnv(env);
  await new Promise((resolve) => server.close(resolve));
});

async function register(body) {
  const res = await fetch(`${baseUrl}/oauth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

describe('registering a client', () => {
  it('issues credentials for a valid request', async () => {
    const res = await register({
      client_name: 'ChatGPT',
      redirect_uris: ['https://chatgpt.com/connector/oauth/abc123'],
      scope: 'training:read workouts:read workouts:write',
    });

    expect(res.status).toBe(201);
    expect(res.body.client_id).toMatch(/^dcr-/);
    expect(res.body.client_secret).toBeTruthy();
    expect(res.body.scope).toBe('training:read workouts:read workouts:write');
  });

  it('needs no credential of its own', async () => {
    // The point of RFC 7591: a client that has never been seen can register.
    const res = await register({
      client_name: 'Unknown', redirect_uris: ['https://example.com/cb'],
    });
    expect(res.status).toBe(201);
  });
});

describe('what a caller may not decide', () => {
  /**
   * A caller-chosen id could collide with an operator-registered client, or be
   * chosen to impersonate one on the consent screen — where the athlete reads a
   * name and decides whether to trust it.
   */
  it('ignores a client_id the caller asks for', async () => {
    const res = await register({
      client_id: 'workout-mcp',
      client_name: 'Impostor',
      redirect_uris: ['https://evil.example.com/cb'],
    });

    expect(res.body.client_id).not.toBe('workout-mcp');
    expect(res.body.client_id).toMatch(/^dcr-/);
  });

  it('assigns the audience rather than accepting one', async () => {
    await register({
      audience: 'some-other-api',
      client_name: 'X', redirect_uris: ['https://example.com/cb'],
    });
    expect(created[0].audience).toBe('manifestathletics-api');
  });

  /** A scope nobody explains on a consent screen must not be grantable. */
  it('refuses to register an invented scope', async () => {
    const res = await register({
      client_name: 'X',
      redirect_uris: ['https://example.com/cb'],
      scope: 'admin:everything',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_client_metadata');
  });

  it('keeps only the offered scopes from a mixed request', async () => {
    const res = await register({
      client_name: 'X',
      redirect_uris: ['https://example.com/cb'],
      scope: 'training:read admin:everything',
    });

    expect(res.status).toBe(201);
    expect(res.body.scope).toBe('training:read');
  });
});

describe('redirect URIs', () => {
  it('requires at least one', async () => {
    const res = await register({ client_name: 'X' });
    expect(res.status).toBe(400);
  });

  it('refuses plain http on a public host', async () => {
    // Validated the same way the operator script validates them: a redirect URI
    // is where an authorization code is delivered.
    const res = await register({
      client_name: 'X', redirect_uris: ['http://evil.example.com/cb'],
    });
    expect(res.status).toBe(400);
  });

  it('allows loopback http, where there is no network to intercept', async () => {
    const res = await register({
      client_name: 'X', redirect_uris: ['http://localhost:3000/cb'],
    });
    expect(res.status).toBe(201);
  });

  it('refuses a fragment, which never reaches the server', async () => {
    const res = await register({
      client_name: 'X', redirect_uris: ['https://example.com/cb#frag'],
    });
    expect(res.status).toBe(400);
  });

  it('bounds how many may be registered at once', async () => {
    const many = Array.from({ length: 11 }, (_, i) => `https://example.com/cb${i}`);
    const res = await register({ client_name: 'X', redirect_uris: many });
    expect(res.status).toBe(400);
  });
});

describe('public clients', () => {
  it('gets no secret when it says it cannot hold one', async () => {
    const res = await register({
      client_name: 'X',
      redirect_uris: ['https://example.com/cb'],
      token_endpoint_auth_method: 'none',
    });

    expect(res.status).toBe(201);
    expect(res.body.client_secret).toBeUndefined();
    expect(created[0].isConfidential).toBe(false);
  });
});
