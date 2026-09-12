import crypto from 'crypto';

const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_TIMEOUT_MS = 5000;
// Floor between forced refetches. Without it, tokens carrying unknown `kid`
// values are an amplification vector: each one would miss the cache and fire a
// request at the auth server.
const DEFAULT_MIN_REFRESH_MS = 30 * 1000;

function jwkToKeyObject(jwk) {
  return crypto.createPublicKey({ key: jwk, format: 'jwk' });
}

/**
 * Caching JWKS fetcher.
 *
 * Keys are cached for `cacheTtlMs`. A `kid` that isn't in the cache triggers at
 * most one refetch per `minRefreshMs`, which covers key rotation without
 * letting unknown-kid tokens drive load.
 */
export function createJwksClient({
  jwksUri,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  minRefreshMs = DEFAULT_MIN_REFRESH_MS,
  fetchImpl,
} = {}) {
  if (!jwksUri) throw new Error('createJwksClient requires a "jwksUri" option');

  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') {
    throw new Error(
      'No fetch implementation available. Use Node >=18 or pass a "fetchImpl" option.',
    );
  }

  let keysByKid = new Map();
  let expiresAt = 0;
  let lastFetchAt = 0;
  let inFlight = null;

  async function refresh() {
    // Collapse concurrent refreshes so a burst of cache misses is one request.
    if (inFlight) return inFlight;

    inFlight = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await doFetch(jwksUri, { signal: controller.signal });
        if (!res.ok) throw new Error(`JWKS fetch failed: HTTP ${res.status}`);
        const body = await res.json();
        if (!body || !Array.isArray(body.keys)) {
          throw new Error('JWKS response has no "keys" array');
        }

        const next = new Map();
        for (const jwk of body.keys) {
          if (!jwk.kid) continue;
          try {
            next.set(jwk.kid, jwkToKeyObject(jwk));
          } catch {
            // One malformed entry must not invalidate the whole key set.
          }
        }
        keysByKid = next;
        expiresAt = Date.now() + cacheTtlMs;
        return keysByKid;
      } finally {
        clearTimeout(timer);
        lastFetchAt = Date.now();
        inFlight = null;
      }
    })();

    return inFlight;
  }

  return {
    /** Public key for `kid`, or null if this key set doesn't contain it. */
    async getKey(kid) {
      if (!kid) return null;
      const now = Date.now();

      if (now >= expiresAt) {
        // Stale cache. If the refresh fails but we still hold keys, serve them
        // rather than failing open OR hard-failing every request -- an auth
        // server blip shouldn't log out a whole fleet.
        try {
          await refresh();
        } catch (err) {
          if (keysByKid.size === 0) throw err;
        }
      }

      const hit = keysByKid.get(kid);
      if (hit) return hit;

      // Unknown kid with a warm cache: likely a rotation we haven't picked up.
      if (now - lastFetchAt >= minRefreshMs) {
        try {
          await refresh();
        } catch {
          return null;
        }
        return keysByKid.get(kid) || null;
      }

      return null;
    },

    /** Test seam. */
    _reset() {
      keysByKid = new Map();
      expiresAt = 0;
      lastFetchAt = 0;
      inFlight = null;
    },
  };
}
