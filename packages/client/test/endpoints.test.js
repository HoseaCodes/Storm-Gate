import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { createStormGateClient } from '../src/client.js';
import { BASE_URL, server } from './server.js';

function makeClient(extra = {}) {
  return createStormGateClient({ baseURL: BASE_URL, ...extra });
}

describe('login', () => {
  beforeEach(() => {
    document.cookie = 'accesstoken=; path=/; max-age=0';
  });

  it('POSTs /login with the request body and writes the cookie on success', async () => {
    let captured;
    server.use(
      http.post(`${BASE_URL}/login`, async ({ request }) => {
        captured = {
          body: await request.json(),
          authHeader: request.headers.get('Authorization'),
        };
        return HttpResponse.json({ accesstoken: 'tok-123', status: 'Successful' });
      }),
    );

    const auth = makeClient();
    const data = await auth.login({ email: 'u@x.com', password: 'pw', rememberMe: true });

    expect(captured.body).toEqual({ email: 'u@x.com', password: 'pw', rememberMe: true });
    expect(captured.authHeader).toBeNull();
    expect(data).toEqual({ accesstoken: 'tok-123', status: 'Successful' });
    expect(document.cookie).toContain('accesstoken=tok-123');
  });

  it('does NOT normalize 400 "Invalid password" to 401 (business error)', async () => {
    const onUnauth = vi.fn();
    const auth = makeClient({ onUnauthenticated: onUnauth, isAuthRequiredRoute: () => true });
    await expect(
      auth.login({ email: 'u@x.com', password: 'wrong' }),
    ).rejects.toMatchObject({ response: { status: 400 } });
    expect(onUnauth).not.toHaveBeenCalled();
  });

  it('returns limitedAccess flag for pending users', async () => {
    const auth = makeClient();
    const data = await auth.login({ email: 'pending@example.com', password: 'pw' });
    expect(data.limitedAccess).toBe(true);
    expect(data.status).toBe('PENDING');
    expect(document.cookie).toContain('accesstoken=pending-token');
  });
});

describe('register', () => {
  it('returns requiresApproval when server pends the user', async () => {
    const auth = makeClient();
    const data = await auth.register({
      name: 'A', email: 'a@x.com', password: 'pw', status: 'PENDING',
    });
    expect(data.requiresApproval).toBe(true);
    expect(document.cookie).not.toContain('accesstoken=');
  });

  it('writes the cookie on immediate-approval registration', async () => {
    const auth = makeClient();
    await auth.register({ name: 'B', email: 'b@x.com', password: 'pw' });
    expect(document.cookie).toContain('accesstoken=new-user-token');
  });
});

describe('getMe', () => {
  it('sends Authorization header WITHOUT Bearer prefix', async () => {
    let captured;
    server.use(
      http.get(`${BASE_URL}/me`, ({ request }) => {
        captured = { authHeader: request.headers.get('Authorization') };
        return HttpResponse.json({ user: { id: 'x' }, status: 'success' });
      }),
    );

    document.cookie = 'accesstoken=tok-xyz; path=/';
    const auth = makeClient();
    await auth.getMe();
    expect(captured.authHeader).toBe('tok-xyz');
    expect(captured.authHeader.startsWith('Bearer ')).toBe(false);
  });
});

describe('logout', () => {
  it('clears the cookie even if the server call succeeds', async () => {
    document.cookie = 'accesstoken=tok-xyz; path=/';
    const auth = makeClient();
    await auth.logout();
    expect(document.cookie).not.toContain('accesstoken=tok-xyz');
  });

  it('clears the cookie even if the server call fails', async () => {
    server.use(
      http.post(`${BASE_URL}/logout`, () =>
        HttpResponse.json({ msg: 'boom' }, { status: 500 }),
      ),
    );
    document.cookie = 'accesstoken=tok-xyz; path=/';
    const auth = makeClient();
    await expect(auth.logout()).rejects.toThrow();
    expect(document.cookie).not.toContain('accesstoken=tok-xyz');
  });
});

describe('refreshToken', () => {
  it('updates the cookie with the new access token', async () => {
    const auth = makeClient();
    await auth.refreshToken();
    expect(document.cookie).toContain('accesstoken=refreshed-token');
  });
});

describe('verifyResetToken', () => {
  it('puts the token in the URL path (not body)', async () => {
    let receivedPath;
    let receivedBody;
    server.use(
      http.post(`${BASE_URL}/verify-reset-token/:token`, async ({ params, request }) => {
        receivedPath = params.token;
        receivedBody = await request.text();
        return HttpResponse.json({ status: 'success', msg: 'ok', email: 'a@x.com' });
      }),
    );
    const auth = makeClient();
    await auth.verifyResetToken('reset-token-abc');
    expect(receivedPath).toBe('reset-token-abc');
    expect(receivedBody).toBe('');
  });
});

describe('resetPassword', () => {
  it('puts the token in the URL path and the password in the body', async () => {
    let captured;
    server.use(
      http.post(`${BASE_URL}/reset-password/:token`, async ({ params, request }) => {
        captured = { token: params.token, body: await request.json() };
        return HttpResponse.json({ status: 'success', msg: 'ok' });
      }),
    );
    const auth = makeClient();
    await auth.resetPassword({ token: 'rst-1', password: 'new-pw' });
    expect(captured.token).toBe('rst-1');
    expect(captured.body).toEqual({ password: 'new-pw' });
  });
});

afterEach(() => {
  document.cookie = 'accesstoken=; path=/; max-age=0';
});
