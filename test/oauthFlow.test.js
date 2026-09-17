// Security properties of the delegated-access flow.
//
// These focus on the checks that, if wrong, hand an attacker a token: redirect
// validation, code binding, PKCE, client authentication, and revocation taking
// effect. Models are mocked, matching passwordReset.test.js -- what is under
// test is the controller's decision-making, not mongoose.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { snapshotEnv, restoreEnv } from './helpers.js';
import { computeS256Challenge } from '../src/utils/pkce.js';

const findOneClient = vi.fn();
const findOneGrant = vi.fn();
const findOneAndUpdateGrant = vi.fn();

vi.mock('../src/models/serviceClient.js', () => ({
  default: { findOne: (...a) => findOneClient(...a) },
}));
vi.mock('../src/models/serviceGrant.js', () => ({
  default: {
    findOne: (...a) => findOneGrant(...a),
    findOneAndUpdate: (...a) => findOneAndUpdateGrant(...a),
    find: vi.fn(),
  },
}));

// Stand-ins for the two credential collections. These keep the behaviour the
// controller depends on -- findOneAndDelete hands the row to exactly one
// caller -- without needing a live MongoDB.
function makeCollection() {
  const rows = new Map();
  return {
    rows,
    create: vi.fn(async (doc) => { rows.set(doc.codeHash ?? doc.tokenHash, { ...doc }); return doc; }),
    findOneAndDelete: vi.fn((filter) => {
      const key = filter.codeHash ?? filter.tokenHash;
      const row = rows.get(key) ?? null;
      rows.delete(key);
      return { lean: async () => row };
    }),
    deleteMany: vi.fn(async (filter) => {
      let deletedCount = 0;
      for (const [k, v] of rows) {
        if (v.userId === filter.userId && v.clientId === filter.clientId) { rows.delete(k); deletedCount += 1; }
      }
      return { deletedCount };
    }),
  };
}

const codeCollection = makeCollection();
const refreshCollection = makeCollection();

vi.mock('../src/models/authorizationCode.js', () => ({
  default: {
    create: (...a) => codeCollection.create(...a),
    findOneAndDelete: (...a) => codeCollection.findOneAndDelete(...a),
  },
}));
vi.mock('../src/models/serviceRefreshToken.js', () => ({
  default: {
    create: (...a) => refreshCollection.create(...a),
    findOneAndDelete: (...a) => refreshCollection.findOneAndDelete(...a),
    deleteMany: (...a) => refreshCollection.deleteMany(...a),
  },
}));

const { default: oauthController } = await import('../src/controllers/oauth.js');

const USER = 'user-123';
const VERIFIER = crypto.randomBytes(48).toString('base64url');
const CHALLENGE = computeS256Challenge(VERIFIER);
const SECRET = 'client-secret-value';

let env;
let server;
let baseUrl;

function makeClient(overrides = {}) {
  return {
    clientId: 'workout-mcp',
    name: 'Workout Coach',
    description: 'Generates your sessions',
    clientSecretHash: bcrypt.hashSync(SECRET, 4),
    redirectUris: ['https://app.test/cb'],
    // Scope vocabulary belongs to the consuming application; Storm-Gate only
    // enforces the ceiling. These are one app's scopes, not built-in ones.
    allowedScopes: ['data:read', 'data:write'],
    audience: 'example-api',
    isConfidential: true,
    status: 'active',
    ...overrides,
  };
}

function makeGrant(overrides = {}) {
  return {
    userId: USER,
    clientId: 'workout-mcp',
    scopes: ['data:read', 'data:write'],
    status: 'active',
    save: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

beforeEach(async () => {
  env = snapshotEnv();
  process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret';
  process.env.ACCESS_TOKEN_SECRET = 'test-access-secret';
  delete process.env.JWT_SIGNING_ALG;
  codeCollection.rows.clear();
  refreshCollection.rows.clear();
  vi.clearAllMocks();

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  // Stand-in for the athlete auth middleware.
  app.use((req, _res, next) => { req.user = { id: USER }; next(); });
  app.get('/oauth/authorize', oauthController.authorize);
  app.post('/oauth/authorize/decision', oauthController.decision);
  app.post('/oauth/token', oauthController.token);
  app.post('/oauth/revoke', oauthController.revoke);

  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  restoreEnv(env);
  await new Promise((resolve) => server.close(resolve));
});

function authorizeUrl(params = {}) {
  const u = new URL('/oauth/authorize', baseUrl);
  const defaults = {
    client_id: 'workout-mcp',
    redirect_uri: 'https://app.test/cb',
    response_type: 'code',
    scope: 'data:read data:write',
    state: 'xyz',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  };
  for (const [k, v] of Object.entries({ ...defaults, ...params })) {
    if (v !== undefined) u.searchParams.set(k, v);
  }
  return u.toString();
}

describe('/oauth/authorize — redirect validation', () => {
  it('refuses an unregistered redirect_uri with 400 and does NOT redirect', async () => {
    findOneClient.mockResolvedValue(makeClient());
    const res = await fetch(authorizeUrl({ redirect_uri: 'https://attacker.example/cb' }), { redirect: 'manual' });
    expect(res.status).toBe(400);
    // The critical property: no Location header. Redirecting an error to an
    // unvalidated URI is the whole vulnerability class.
    expect(res.headers.get('location')).toBeNull();
  });

  it('refuses a path-extended variant of a registered URI', async () => {
    findOneClient.mockResolvedValue(makeClient());
    const res = await fetch(authorizeUrl({ redirect_uri: 'https://app.test/cb/../evil' }), { redirect: 'manual' });
    expect(res.status).toBe(400);
  });

  it('refuses an unknown client without redirecting', async () => {
    findOneClient.mockResolvedValue(null);
    const res = await fetch(authorizeUrl(), { redirect: 'manual' });
    expect(res.status).toBe(400);
    expect(res.headers.get('location')).toBeNull();
  });

  it('redirects OAuth errors only once redirect_uri is known good', async () => {
    findOneClient.mockResolvedValue(makeClient());
    findOneGrant.mockResolvedValue(null);
    const res = await fetch(authorizeUrl({ response_type: 'token' }), { redirect: 'manual' });
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('location'));
    expect(loc.origin + loc.pathname).toBe('https://app.test/cb');
    expect(loc.searchParams.get('error')).toBe('unsupported_response_type');
    expect(loc.searchParams.get('state')).toBe('xyz');
  });
});

describe('/oauth/authorize — PKCE and scope', () => {
  beforeEach(() => findOneClient.mockResolvedValue(makeClient()));

  it('requires PKCE S256 and rejects plain', async () => {
    const res = await fetch(authorizeUrl({ code_challenge_method: 'plain' }), { redirect: 'manual' });
    expect(new URL(res.headers.get('location')).searchParams.get('error')).toBe('invalid_request');
  });

  it('rejects a scope beyond the client ceiling', async () => {
    findOneClient.mockResolvedValue(makeClient({ allowedScopes: ['data:read'] }));
    const res = await fetch(authorizeUrl({ scope: 'data:write' }), { redirect: 'manual' });
    const loc = new URL(res.headers.get('location'));
    expect(loc.searchParams.get('error')).toBe('invalid_scope');
  });

  // Storm-Gate has no built-in scope list, so "unknown" simply means "not
  // registered for this client" -- which is the same check.
  it('rejects a scope the client never registered', async () => {
    const res = await fetch(authorizeUrl({ scope: 'data:delete' }), { redirect: 'manual' });
    expect(new URL(res.headers.get('location')).searchParams.get('error')).toBe('invalid_scope');
  });

  it('asks for consent when no grant covers the request', async () => {
    findOneGrant.mockResolvedValue(null);
    const res = await fetch(authorizeUrl(), { redirect: 'manual' });
    const body = await res.json();
    expect(body.consent_required).toBe(true);
    expect(body.client.name).toBe('Workout Coach');
    expect(body.requested_scopes).toEqual(['data:read', 'data:write']);
  });

  it('skips consent when an existing grant already covers it', async () => {
    findOneGrant.mockResolvedValue(makeGrant());
    const res = await fetch(authorizeUrl(), { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get('location')).searchParams.get('code')).toBeTruthy();
  });

  it('re-prompts when the request widens beyond the existing grant', async () => {
    findOneGrant.mockResolvedValue(makeGrant({ scopes: ['data:read'] }));
    const res = await fetch(authorizeUrl({ scope: 'data:read data:write' }), { redirect: 'manual' });
    const body = await res.json();
    expect(body.consent_required).toBe(true);
  });
});

async function getCode() {
  findOneClient.mockResolvedValue(makeClient());
  findOneGrant.mockResolvedValue(makeGrant());
  const res = await fetch(authorizeUrl(), { redirect: 'manual' });
  return new URL(res.headers.get('location')).searchParams.get('code');
}

function tokenBody(params) {
  return new URLSearchParams(params).toString();
}

async function postToken(params) {
  return fetch(`${baseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody(params),
  });
}

describe('/oauth/token — authorization_code', () => {
  it('issues a token carrying sub, act.sub, scope, aud and jti', async () => {
    const code = await getCode();
    const res = await postToken({
      grant_type: 'authorization_code', code, client_id: 'workout-mcp',
      client_secret: SECRET, redirect_uri: 'https://app.test/cb', code_verifier: VERIFIER,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token_type).toBe('Bearer');
    expect(body.expires_in).toBe(900);

    const claims = JSON.parse(Buffer.from(body.access_token.split('.')[1], 'base64url').toString());
    expect(claims.sub).toBe(USER);
    expect(claims.act).toEqual({ sub: 'workout-mcp' });
    // Audience comes from the client record, not a global constant.
    expect(claims.aud).toBe('example-api');
    expect(claims.scope).toBe('data:read data:write');
    expect(claims.jti).toBeTruthy();
    // Kept for consumers still reading `id` rather than `sub`.
    expect(claims.id).toBe(USER);
  });

  it('rejects a wrong client secret', async () => {
    const code = await getCode();
    const res = await postToken({
      grant_type: 'authorization_code', code, client_id: 'workout-mcp',
      client_secret: 'wrong', redirect_uri: 'https://app.test/cb', code_verifier: VERIFIER,
    });
    expect(res.status).toBe(401);
  });

  it('rejects a mismatched PKCE verifier', async () => {
    const code = await getCode();
    const res = await postToken({
      grant_type: 'authorization_code', code, client_id: 'workout-mcp',
      client_secret: SECRET, redirect_uri: 'https://app.test/cb',
      code_verifier: crypto.randomBytes(48).toString('base64url'),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_grant');
  });

  it('rejects a redirect_uri that differs from the authorize request', async () => {
    const code = await getCode();
    const res = await postToken({
      grant_type: 'authorization_code', code, client_id: 'workout-mcp',
      client_secret: SECRET, redirect_uri: 'https://app.test/other', code_verifier: VERIFIER,
    });
    expect(res.status).toBe(400);
  });

  // A code is a bearer credential for its lifetime.
  it('refuses to redeem the same code twice', async () => {
    const code = await getCode();
    const args = {
      grant_type: 'authorization_code', code, client_id: 'workout-mcp',
      client_secret: SECRET, redirect_uri: 'https://app.test/cb', code_verifier: VERIFIER,
    };
    expect((await postToken(args)).status).toBe(200);
    expect((await postToken(args)).status).toBe(400);
  });

  it('refuses a code issued to a different client', async () => {
    const code = await getCode();
    findOneClient.mockResolvedValue(makeClient({ clientId: 'other-client' }));
    const res = await postToken({
      grant_type: 'authorization_code', code, client_id: 'other-client',
      client_secret: SECRET, redirect_uri: 'https://app.test/cb', code_verifier: VERIFIER,
    });
    expect(res.status).toBe(400);
  });

  it('refuses when the grant was revoked between authorize and redeem', async () => {
    const code = await getCode();
    findOneGrant.mockResolvedValue(null); // revoked in the interim
    const res = await postToken({
      grant_type: 'authorization_code', code, client_id: 'workout-mcp',
      client_secret: SECRET, redirect_uri: 'https://app.test/cb', code_verifier: VERIFIER,
    });
    expect(res.status).toBe(400);
  });

  it('narrows the token to scopes the grant still carries', async () => {
    const code = await getCode();
    findOneGrant.mockResolvedValue(makeGrant({ scopes: ['data:read'] }));
    const res = await postToken({
      grant_type: 'authorization_code', code, client_id: 'workout-mcp',
      client_secret: SECRET, redirect_uri: 'https://app.test/cb', code_verifier: VERIFIER,
    });
    const claims = JSON.parse(Buffer.from((await res.json()).access_token.split('.')[1], 'base64url').toString());
    expect(claims.scope).toBe('data:read');
  });
});

describe('/oauth/token — refresh and revocation', () => {
  async function getRefreshToken() {
    const code = await getCode();
    const res = await postToken({
      grant_type: 'authorization_code', code, client_id: 'workout-mcp',
      client_secret: SECRET, redirect_uri: 'https://app.test/cb', code_verifier: VERIFIER,
    });
    return (await res.json()).refresh_token;
  }

  it('exchanges a refresh token for a new access token', async () => {
    const refresh = await getRefreshToken();
    const res = await postToken({
      grant_type: 'refresh_token', refresh_token: refresh,
      client_id: 'workout-mcp', client_secret: SECRET,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).access_token).toBeTruthy();
  });

  // The property the whole revocation design rests on.
  it('refuses to refresh once the grant is revoked', async () => {
    const refresh = await getRefreshToken();
    findOneGrant.mockResolvedValue(null); // athlete revoked
    const res = await postToken({
      grant_type: 'refresh_token', refresh_token: refresh,
      client_id: 'workout-mcp', client_secret: SECRET,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error_description).toMatch(/revoked/i);
  });

  it('rotates: a refresh token cannot be reused', async () => {
    const refresh = await getRefreshToken();
    expect((await postToken({ grant_type: 'refresh_token', refresh_token: refresh, client_id: 'workout-mcp', client_secret: SECRET })).status).toBe(200);
    expect((await postToken({ grant_type: 'refresh_token', refresh_token: refresh, client_id: 'workout-mcp', client_secret: SECRET })).status).toBe(400);
  });

  it('rejects an unsupported grant_type', async () => {
    const res = await postToken({ grant_type: 'password', client_id: 'workout-mcp', client_secret: SECRET });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('unsupported_grant_type');
  });
});
