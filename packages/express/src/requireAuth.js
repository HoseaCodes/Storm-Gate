import jwt from 'jsonwebtoken';
import { extractToken } from './extractToken.js';
import { createJwksClient } from './jwks.js';

function denyFor(res, err) {
  const msg = err.name === 'TokenExpiredError'
    ? 'Token expired'
    : 'Invalid authentication token';
  return res.status(401).json({ msg, code: err.name });
}

/**
 * Express middleware that verifies a Storm-Gate access token.
 *
 * Two modes:
 *
 *   createRequireAuth({ secret })
 *     HS256 against a shared secret. Synchronous, unchanged behaviour.
 *
 *   createRequireAuth({ jwksUri, secret })
 *     RS256 verified against Storm-Gate's published JWKS, with the shared
 *     secret still accepted for HS256 tokens. Pass both during a migration so
 *     tokens issued before the cutover keep working until they expire; drop
 *     `secret` once they have.
 *
 * @param {object}   options
 * @param {string}  [options.secret]     HS256 shared secret.
 * @param {string}  [options.jwksUri]    e.g. https://auth.example.com/.well-known/jwks.json
 * @param {string[]}[options.algorithms] Allowed algorithms for the HS256 path. Default ['HS256'].
 * @param {string}  [options.issuer]     Required `iss` on asymmetric tokens.
 * @param {string|string[]} [options.audience] Required `aud` on asymmetric tokens.
 * @param {number}  [options.cacheTtlMs] JWKS cache lifetime. Default 1 hour.
 * @param {number}  [options.minRefreshMs] Floor between forced JWKS refetches
 *                  when a token carries an unknown `kid`. Default 30s.
 * @param {function}[options.fetchImpl]  Override fetch (tests, proxies).
 */
export function createRequireAuth({
  secret,
  jwksUri,
  algorithms = ['HS256'],
  issuer,
  audience,
  cacheTtlMs,
  minRefreshMs,
  fetchImpl,
} = {}) {
  if (!secret && !jwksUri) {
    throw new Error(
      'createRequireAuth requires a "secret" option, or a "jwksUri" to verify RS256 tokens',
    );
  }

  // Symmetric-only: keep the original synchronous path exactly as it was.
  if (!jwksUri) {
    return function requireAuth(req, res, next) {
      const token = extractToken(req.headers?.authorization || req.header?.('Authorization'));
      if (!token) {
        return res.status(401).json({ msg: 'Missing authentication token' });
      }

      jwt.verify(token, secret, { algorithms }, (err, decoded) => {
        if (err) return denyFor(res, err);
        req.user = decoded;
        next();
      });
    };
  }

  const jwks = createJwksClient({ jwksUri, cacheTtlMs, minRefreshMs, fetchImpl });

  return async function requireAuth(req, res, next) {
    const token = extractToken(req.headers?.authorization || req.header?.('Authorization'));
    if (!token) {
      return res.status(401).json({ msg: 'Missing authentication token' });
    }

    let header;
    try {
      header = jwt.decode(token, { complete: true })?.header;
    } catch {
      header = null;
    }
    if (!header) {
      return res.status(401).json({ msg: 'Invalid authentication token', code: 'JsonWebTokenError' });
    }

    // Pick the key from the token header, then pin `algorithms` to the single
    // algorithm that key can validate. Never let the token's own `alg` select
    // which key material is used without that pin -- that is exactly the
    // RS256->HS256 confusion attack, and it becomes reachable the moment a
    // public key is published.
    const isAsymmetric = typeof header.alg === 'string' && /^(RS|PS|ES)\d{3}$/.test(header.alg);

    if (isAsymmetric) {
      if (header.alg !== 'RS256') {
        return res.status(401).json({ msg: 'Invalid authentication token', code: 'JsonWebTokenError' });
      }

      let key;
      try {
        key = await jwks.getKey(header.kid);
      } catch (err) {
        // The auth server is unreachable and we hold no usable keys. This is a
        // dependency failure, not a bad credential; 503 keeps clients from
        // discarding an otherwise valid session.
        return res.status(503).json({ msg: 'Unable to verify token: key set unavailable', code: 'JwksUnavailable' });
      }
      if (!key) {
        return res.status(401).json({ msg: 'Invalid authentication token', code: 'UnknownSigningKey' });
      }

      const verifyOptions = { algorithms: ['RS256'] };
      if (issuer) verifyOptions.issuer = issuer;
      if (audience) verifyOptions.audience = audience;

      return jwt.verify(token, key, verifyOptions, (err, decoded) => {
        if (err) return denyFor(res, err);
        req.user = decoded;
        next();
      });
    }

    // Symmetric token arriving at a JWKS-configured verifier: only valid while
    // a shared secret is still configured for the migration window.
    if (!secret) {
      return res.status(401).json({ msg: 'Invalid authentication token', code: 'JsonWebTokenError' });
    }

    return jwt.verify(token, secret, { algorithms }, (err, decoded) => {
      if (err) return denyFor(res, err);
      req.user = decoded;
      next();
    });
  };
}
