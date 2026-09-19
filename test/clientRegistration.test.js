// Registration validation. These rules exist because redirect URIs are matched
// by exact string equality at authorize time -- a malformed one produces a
// client that can never complete a flow, and a permissive one produces a token
// exfiltration route.
import { describe, expect, it } from 'vitest';
import { validateRedirectUri, validateRegistration } from '../src/utils/clientRegistration.js';

describe('validateRedirectUri', () => {
  it('accepts https', () => {
    expect(validateRedirectUri('https://app.test/cb')).toBeNull();
  });

  // Loopback has no network segment to intercept, which is the only reason
  // plain http is tolerable anywhere.
  it('accepts http only on loopback', () => {
    expect(validateRedirectUri('http://localhost:3000/cb')).toBeNull();
    expect(validateRedirectUri('http://127.0.0.1:3000/cb')).toBeNull();
    expect(validateRedirectUri('http://app.test/cb')).toMatch(/must be https/);
  });

  // A fragment never reaches the server, so it can never match.
  it('rejects a fragment', () => {
    expect(validateRedirectUri('https://app.test/cb#x')).toMatch(/fragment/);
  });

  it('rejects embedded credentials', () => {
    expect(validateRedirectUri('https://u:p@app.test/cb')).toMatch(/credentials/);
  });

  it('rejects non-absolute and non-URL input', () => {
    expect(validateRedirectUri('/cb')).toMatch(/not a valid absolute URL/);
    expect(validateRedirectUri('nonsense')).toMatch(/not a valid absolute URL/);
  });

  it('rejects dangerous schemes', () => {
    expect(validateRedirectUri('javascript:alert(1)')).toMatch(/must be https/);
  });
});

describe('validateRegistration', () => {
  const valid = {
    clientId: 'workout-mcp',
    redirectUris: ['https://app.test/cb'],
    audience: 'example-api',
    scopes: ['data:read'],
    isNew: true,
  };

  it('accepts a complete new registration', () => {
    expect(validateRegistration(valid)).toEqual([]);
  });

  it('requires a redirect, audience and scope for a new client', () => {
    const errors = validateRegistration({ clientId: 'x-y', isNew: true });
    expect(errors.some((e) => e.includes('--redirect'))).toBe(true);
    expect(errors.some((e) => e.includes('--audience'))).toBe(true);
    expect(errors.some((e) => e.includes('--scope'))).toBe(true);
  });

  // An update should not have to re-supply everything.
  it('does not require them when updating an existing client', () => {
    expect(validateRegistration({ clientId: 'x-y', isNew: false })).toEqual([]);
  });

  it('constrains the client id format', () => {
    for (const bad of ['', 'A', 'has space', 'UPPER', 'x', 'has_underscore']) {
      expect(validateRegistration({ ...valid, clientId: bad }).length).toBeGreaterThan(0);
    }
    expect(validateRegistration({ ...valid, clientId: 'ab' })).toEqual([]);
  });

  it('reports every bad redirect, not just the first', () => {
    const errors = validateRegistration({
      ...valid,
      redirectUris: ['http://a.test/cb', 'https://b.test/cb#f'],
    });
    expect(errors.filter((e) => e.startsWith('Invalid redirect URI')).length).toBe(2);
  });
});
