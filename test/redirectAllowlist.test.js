// Regression tests for the open redirect that leaked access tokens.
//
// Before this, /api/auth/oidc/login?return_url=https://attacker.example walked a
// victim through a genuine Azure AD login and then redirected to the attacker
// with a valid access token in the query string.
import { describe, expect, it } from 'vitest';
import {
  getAllowedReturnOrigins,
  isAllowedReturnUrl,
  resolveReturnUrl,
} from '../src/utils/redirectAllowlist.js';

const ALLOWED = 'https://www.manifestathletics.com,http://localhost:3000';

describe('getAllowedReturnOrigins', () => {
  it('parses a comma-separated list into normalized origins', () => {
    const origins = getAllowedReturnOrigins(ALLOWED);
    expect(origins.has('https://www.manifestathletics.com')).toBe(true);
    expect(origins.has('http://localhost:3000')).toBe(true);
  });

  it('normalizes a trailing slash to the same origin', () => {
    expect(getAllowedReturnOrigins('https://x.test/').has('https://x.test')).toBe(true);
  });

  it('skips malformed entries rather than throwing', () => {
    const origins = getAllowedReturnOrigins('not a url, https://x.test');
    expect(origins.has('https://x.test')).toBe(true);
    expect(origins.size).toBe(1);
  });

  it('returns an empty set when unset', () => {
    expect(getAllowedReturnOrigins(undefined).size).toBe(0);
    expect(getAllowedReturnOrigins('').size).toBe(0);
  });
});

describe('isAllowedReturnUrl — allows', () => {
  it('an exact allowlisted origin', () => {
    expect(isAllowedReturnUrl('https://www.manifestathletics.com', ALLOWED)).toBe(true);
  });

  it('any path, query or fragment under an allowlisted origin', () => {
    expect(isAllowedReturnUrl('https://www.manifestathletics.com/dashboard?a=1#x', ALLOWED)).toBe(true);
  });

  it('a non-default port when that port is allowlisted', () => {
    expect(isAllowedReturnUrl('http://localhost:3000/auth/callback', ALLOWED)).toBe(true);
  });
});

describe('isAllowedReturnUrl — blocks', () => {
  it('an unrelated origin', () => {
    expect(isAllowedReturnUrl('https://attacker.example', ALLOWED)).toBe(false);
  });

  // The canonical bypass for prefix matching.
  it('a suffix-extended lookalike host', () => {
    expect(isAllowedReturnUrl('https://www.manifestathletics.com.attacker.test', ALLOWED)).toBe(false);
  });

  it('a subdomain that is not itself allowlisted', () => {
    expect(isAllowedReturnUrl('https://evil.www.manifestathletics.com', ALLOWED)).toBe(false);
  });

  it('a different scheme on an allowlisted host', () => {
    expect(isAllowedReturnUrl('http://www.manifestathletics.com', ALLOWED)).toBe(false);
  });

  it('a different port on an allowlisted host', () => {
    expect(isAllowedReturnUrl('http://localhost:9999', ALLOWED)).toBe(false);
  });

  // Embedded credentials: some clients navigate to the host after the @.
  it('a URL carrying credentials', () => {
    expect(isAllowedReturnUrl('https://evil@www.manifestathletics.com', ALLOWED)).toBe(false);
    expect(isAllowedReturnUrl('https://user:pw@www.manifestathletics.com', ALLOWED)).toBe(false);
  });

  it('non-http schemes', () => {
    expect(isAllowedReturnUrl('javascript:alert(1)', ALLOWED)).toBe(false);
    expect(isAllowedReturnUrl('data:text/html,<script>1</script>', ALLOWED)).toBe(false);
    expect(isAllowedReturnUrl('file:///etc/passwd', ALLOWED)).toBe(false);
  });

  it('protocol-relative and relative URLs', () => {
    expect(isAllowedReturnUrl('//attacker.example', ALLOWED)).toBe(false);
    expect(isAllowedReturnUrl('/dashboard', ALLOWED)).toBe(false);
  });

  it('empty and non-string input', () => {
    expect(isAllowedReturnUrl('', ALLOWED)).toBe(false);
    expect(isAllowedReturnUrl(null, ALLOWED)).toBe(false);
    expect(isAllowedReturnUrl(undefined, ALLOWED)).toBe(false);
    expect(isAllowedReturnUrl({}, ALLOWED)).toBe(false);
  });

  // Fails closed: an unconfigured allowlist permits nothing, rather than
  // degrading to "allow everything" the way a missing check would.
  it('everything when the allowlist is unconfigured', () => {
    expect(isAllowedReturnUrl('https://www.manifestathletics.com', undefined)).toBe(false);
    expect(isAllowedReturnUrl('https://www.manifestathletics.com', '')).toBe(false);
  });
});

describe('resolveReturnUrl', () => {
  it('returns the url when allowed', () => {
    expect(resolveReturnUrl('https://www.manifestathletics.com/x', ALLOWED))
      .toBe('https://www.manifestathletics.com/x');
  });

  it('returns null when not allowed, so callers fall back rather than redirect', () => {
    expect(resolveReturnUrl('https://attacker.example', ALLOWED)).toBe(null);
  });
});
