// PKCE (RFC 7636) verification for the authorization-code flow.
//
// PKCE is what stops a stolen authorization code from being redeemed by anyone
// but the client that started the flow. It matters more here than in a browser
// app: an MCP client may be a desktop process that cannot keep a secret, so
// PKCE is sometimes the only client proof there is.
//
// `plain` is deliberately unsupported. It is still in the RFC for legacy
// clients, but it provides no protection -- the "challenge" is the verifier --
// and accepting it lets a downgrade attack strip the protection entirely.
import crypto from 'crypto';

/** Constant-time string compare that tolerates unequal lengths. */
function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  // timingSafeEqual throws on length mismatch, which would itself leak length.
  // Hash both sides first so the compared buffers are always the same size.
  const hashA = crypto.createHash('sha256').update(bufA).digest();
  const hashB = crypto.createHash('sha256').update(bufB).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

/** S256 challenge for a verifier: BASE64URL(SHA256(ASCII(verifier))). */
export function computeS256Challenge(verifier) {
  return crypto.createHash('sha256').update(String(verifier), 'ascii').digest('base64url');
}

/**
 * True when `verifier` matches `challenge` under `method`.
 * Fails closed on anything unexpected, including a missing verifier.
 */
export function verifyPkce(verifier, challenge, method = 'S256') {
  if (!verifier || !challenge) return false;
  if (String(method).toUpperCase() !== 'S256') return false;

  // RFC 7636 §4.1: 43-128 chars from the unreserved set. A short verifier is
  // brute-forceable, so length is a security bound, not a formatting nicety.
  const v = String(verifier);
  if (v.length < 43 || v.length > 128) return false;
  if (!/^[A-Za-z0-9\-._~]+$/.test(v)) return false;

  return timingSafeEqual(computeS256Challenge(v), challenge);
}

/** True when a client-supplied code_challenge_method is one we accept. */
export function isSupportedChallengeMethod(method) {
  return String(method || '').toUpperCase() === 'S256';
}
