import { beforeEach, describe, expect, it } from 'vitest';
import { createCookieStore } from '../src/cookie.js';

describe('createCookieStore', () => {
  let store;

  beforeEach(() => {
    store = createCookieStore({ cookieName: 'accesstoken' });
    store.clear();
  });

  it('write then read roundtrips the token', () => {
    store.write('abc.def.ghi');
    expect(store.read()).toBe('abc.def.ghi');
  });

  it('strips a leading "JWT " prefix on read (defensive)', () => {
    document.cookie = `accesstoken=${encodeURIComponent('JWT abc.def.ghi')}; path=/`;
    expect(store.read()).toBe('abc.def.ghi');
  });

  it('strips a leading "JWT " prefix on write (never persists it)', () => {
    store.write('JWT abc.def.ghi');
    expect(document.cookie).toContain('accesstoken=abc.def.ghi');
  });

  it('clear removes the cookie', () => {
    store.write('abc.def.ghi');
    store.clear();
    expect(store.read()).toBeNull();
  });

  it('supports a custom cookie name', () => {
    const custom = createCookieStore({ cookieName: 'sg_token' });
    custom.write('xyz');
    expect(custom.read()).toBe('xyz');
    expect(store.read()).toBeNull();
    custom.clear();
  });

  it('write includes max-age when provided', () => {
    store.write('abc', { maxAge: 3600 });
    expect(document.cookie).toContain('accesstoken=abc');
  });
});
