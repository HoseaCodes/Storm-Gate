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

/*
 * Authorization code lifetime.
 *
 * A redirect delivers the code to the client's browser; the client's backend
 * then exchanges it. That round trip crosses a redirect chain, a queue and the
 * user's network, and sixty seconds was not enough for it — ChatGPT's codes
 * were issued and never redeemed, which from the outside is indistinguishable
 * from a wrong secret or a broken endpoint.
 */
describe('authorization code lifetime', () => {
  it('is long enough for a browser-to-backend exchange', async () => {
    const { CODE_TTL_MS } = await import('../src/utils/authCodeStore.js');
    // A minute is shorter than real clients take.
    expect(CODE_TTL_MS).toBeGreaterThan(60_000);
  });

  it('stays well inside the ten minutes RFC 6749 §4.1.2 recommends', async () => {
    const { CODE_TTL_MS } = await import('../src/utils/authCodeStore.js');
    expect(CODE_TTL_MS).toBeLessThanOrEqual(10 * 60_000);
  });
});
