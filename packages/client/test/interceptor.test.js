import { describe, expect, it, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { createStormGateClient } from '../src/client.js';
import { BASE_URL, server } from './server.js';

function mockLocation(pathname) {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, pathname },
    configurable: true,
  });
}

describe('400 → 401 normalization', () => {
  beforeEach(() => {
    document.cookie = 'accesstoken=expired-token; path=/';
    mockLocation('/admin/dashboard');
  });

  it('normalizes 400 "Token Expired Error" to 401 on a non-login endpoint', async () => {
    const auth = createStormGateClient({
      baseURL: BASE_URL,
      isAuthRequiredRoute: (p) => p.startsWith('/admin'),
    });

    await expect(auth.getMe()).rejects.toMatchObject({
      response: { status: 401 },
      normalized: true,
    });
  });

  it('fires onUnauthenticated when the route is auth-required', async () => {
    const onUnauth = vi.fn();
    const auth = createStormGateClient({
      baseURL: BASE_URL,
      isAuthRequiredRoute: (p) => p.startsWith('/admin'),
      onUnauthenticated: onUnauth,
    });

    await expect(auth.getMe()).rejects.toThrow();
    expect(onUnauth).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire onUnauthenticated when the route is public', async () => {
    mockLocation('/blog/some-post');
    const onUnauth = vi.fn();
    const auth = createStormGateClient({
      baseURL: BASE_URL,
      isAuthRequiredRoute: (p) => p.startsWith('/admin'),
      onUnauthenticated: onUnauth,
    });

    await expect(auth.getMe()).rejects.toThrow();
    expect(onUnauth).not.toHaveBeenCalled();
  });

  it('fires onUnauthenticated only once across multiple failures (debounced)', async () => {
    const onUnauth = vi.fn();
    const auth = createStormGateClient({
      baseURL: BASE_URL,
      isAuthRequiredRoute: () => true,
      onUnauthenticated: onUnauth,
    });

    await expect(auth.getMe()).rejects.toThrow();
    await expect(auth.getMe()).rejects.toThrow();
    await expect(auth.getMe()).rejects.toThrow();
    expect(onUnauth).toHaveBeenCalledTimes(1);
  });

  it('resets the debounce after a successful response', async () => {
    const onUnauth = vi.fn();
    const auth = createStormGateClient({
      baseURL: BASE_URL,
      isAuthRequiredRoute: () => true,
      onUnauthenticated: onUnauth,
    });

    await expect(auth.getMe()).rejects.toThrow();

    document.cookie = 'accesstoken=valid; path=/';
    await auth.getMe();

    document.cookie = 'accesstoken=expired-token; path=/';
    await expect(auth.getMe()).rejects.toThrow();

    expect(onUnauth).toHaveBeenCalledTimes(2);
  });

  it('strictNormalization: true skips the 400 heuristic', async () => {
    const onUnauth = vi.fn();
    const auth = createStormGateClient({
      baseURL: BASE_URL,
      isAuthRequiredRoute: () => true,
      onUnauthenticated: onUnauth,
      strictNormalization: true,
    });

    await expect(auth.getMe()).rejects.toMatchObject({
      response: { status: 400 },
    });
    expect(onUnauth).not.toHaveBeenCalled();
  });

  it('does not normalize 400 from login (business error)', async () => {
    const onUnauth = vi.fn();
    const auth = createStormGateClient({
      baseURL: BASE_URL,
      isAuthRequiredRoute: () => true,
      onUnauthenticated: onUnauth,
    });

    server.use(
      http.post(`${BASE_URL}/login`, () =>
        HttpResponse.json({ msg: 'Token Expired Error' }, { status: 400 }),
      ),
    );

    await expect(
      auth.login({ email: 'u@x.com', password: 'pw' }),
    ).rejects.toMatchObject({ response: { status: 400 } });
    expect(onUnauth).not.toHaveBeenCalled();
  });

  it('passes real 401 through (no rewrite)', async () => {
    server.use(
      http.get(`${BASE_URL}/me`, () =>
        HttpResponse.json({ msg: 'real 401' }, { status: 401 }),
      ),
    );
    const auth = createStormGateClient({
      baseURL: BASE_URL,
      isAuthRequiredRoute: () => true,
    });
    await expect(auth.getMe()).rejects.toMatchObject({
      response: { status: 401 },
    });
  });
});
