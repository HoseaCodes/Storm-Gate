import { describe, expect, it } from 'vitest';
import { extractToken } from '../src/extractToken.js';

describe('extractToken', () => {
  it('returns null for missing header', () => {
    expect(extractToken(undefined)).toBeNull();
    expect(extractToken(null)).toBeNull();
    expect(extractToken('')).toBeNull();
  });

  it('returns null for whitespace-only header', () => {
    expect(extractToken('   ')).toBeNull();
  });

  it('returns raw token when no Bearer prefix', () => {
    expect(extractToken('abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('strips Bearer prefix (case-insensitive)', () => {
    expect(extractToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(extractToken('bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(extractToken('BEARER abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('returns null when Bearer prefix has no token', () => {
    expect(extractToken('Bearer ')).toBeNull();
    expect(extractToken('Bearer    ')).toBeNull();
  });

  it('preserves token contents (no JWT parsing here)', () => {
    expect(extractToken('Bearer not.a.real.jwt')).toBe('not.a.real.jwt');
  });

  it('ignores non-string input', () => {
    expect(extractToken(123)).toBeNull();
    expect(extractToken({})).toBeNull();
  });
});
