// Validation for operator-supplied redirect targets.
//
// Storm-Gate hands a caller-supplied URL to res.redirect() after a successful
// login. Without validation that is an open redirect, and because the redirect
// carried an access token it was also a token-exfiltration primitive: a link to
// Storm-Gate's own domain with ?return_url=https://attacker.example walked the
// victim through a genuine login and delivered a valid token to the attacker.
//
// The rules here are deliberately strict, because every relaxation of redirect
// validation is a known bypass:
//
//   * Compare the parsed ORIGIN, never a string prefix. Prefix matching lets
//     https://app.example.com.attacker.test through.
//   * No wildcards, no subdomain matching. If a new origin needs access, an
//     operator adds it.
//   * Only http/https. Blocks javascript:, data: and app-scheme redirects.
//   * Reject credentials in the URL. https://evil@allowed.example parses with
//     origin https://allowed.example in some parsers but navigates elsewhere in
//     some clients.
//
// The allowlist itself is env-driven so it can differ per deployment:
//   OIDC_ALLOWED_RETURN_ORIGINS  comma-separated origins, e.g.
//                                "https://app.example.com,http://localhost:3000"

/** Parse the configured allowlist into a Set of normalized origins. */
export function getAllowedReturnOrigins(raw = process.env.OIDC_ALLOWED_RETURN_ORIGINS) {
  if (!raw || typeof raw !== 'string') return new Set();
  const origins = new Set();
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    try {
      // Normalize through the URL parser so "https://x.test/" and
      // "https://x.test" configure the same thing.
      origins.add(new URL(trimmed).origin);
    } catch {
      // A malformed entry is a configuration error. Skip it rather than
      // throwing at request time; isAllowedReturnUrl fails closed anyway.
    }
  }
  return origins;
}

/**
 * True when `candidate` is a URL we are willing to redirect to.
 *
 * Fails closed: an unparseable URL, an unconfigured allowlist, or anything not
 * explicitly listed returns false.
 */
export function isAllowedReturnUrl(candidate, raw = process.env.OIDC_ALLOWED_RETURN_ORIGINS) {
  if (!candidate || typeof candidate !== 'string') return false;

  let url;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

  // Embedded credentials change where some clients actually navigate.
  if (url.username || url.password) return false;

  return getAllowedReturnOrigins(raw).has(url.origin);
}

/**
 * Resolve the redirect target for a login, or null to fall back to a JSON
 * response. Throws nothing: callers decide how to report a rejection.
 */
export function resolveReturnUrl(candidate, raw = process.env.OIDC_ALLOWED_RETURN_ORIGINS) {
  return isAllowedReturnUrl(candidate, raw) ? candidate : null;
}
