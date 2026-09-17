import { describe, expect, it } from 'vitest';
import crypto from 'crypto';
import { computeS256Challenge, verifyPkce, isSupportedChallengeMethod } from '../src/utils/pkce.js';
import { hashCode } from '../src/utils/authCodeStore.js';

const validVerifier = crypto.randomBytes(48).toString('base64url'); // 64 chars

describe('PKCE', () => {
  it('accepts a verifier matching its S256 challenge', () => {
    expect(verifyPkce(validVerifier, computeS256Challenge(validVerifier))).toBe(true);
  });

  it('rejects a mismatched verifier', () => {
    expect(verifyPkce(validVerifier, computeS256Challenge('something-else-entirely-that-is-long-enough-xx'))).toBe(false);
  });

  // Downgrade protection: `plain` offers no protection at all.
  it('rejects the plain method even when the values match', () => {
    expect(verifyPkce(validVerifier, validVerifier, 'plain')).toBe(false);
    expect(isSupportedChallengeMethod('plain')).toBe(false);
    expect(isSupportedChallengeMethod('S256')).toBe(true);
  });

  it('enforces the RFC 7636 length bounds', () => {
    const short = 'a'.repeat(42);
    const long = 'a'.repeat(129);
    expect(verifyPkce(short, computeS256Challenge(short))).toBe(false);
    expect(verifyPkce(long, computeS256Challenge(long))).toBe(false);
    const min = 'a'.repeat(43);
    expect(verifyPkce(min, computeS256Challenge(min))).toBe(true);
  });

  it('rejects characters outside the unreserved set', () => {
    const bad = 'a'.repeat(42) + '!';
    expect(verifyPkce(bad, computeS256Challenge(bad))).toBe(false);
  });

  it('fails closed on missing input', () => {
    expect(verifyPkce(undefined, 'x')).toBe(false);
    expect(verifyPkce(validVerifier, undefined)).toBe(false);
    expect(verifyPkce(null, null)).toBe(false);
  });
});

describe('authorization code hashing', () => {
  // Codes are stored hashed, so database read access yields nothing redeemable.
  it('hashes deterministically and does not echo the code', () => {
    const code = crypto.randomBytes(32).toString('base64url');
    expect(hashCode(code)).toBe(hashCode(code));
    expect(hashCode(code)).not.toContain(code);
    expect(hashCode(code)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('separates distinct codes', () => {
    expect(hashCode('a')).not.toBe(hashCode('b'));
  });
});
