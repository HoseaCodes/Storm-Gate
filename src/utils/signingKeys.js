// RSA signing-key management for Storm-Gate-issued access tokens.
//
// Storm-Gate has historically signed access tokens with HS256 and a shared
// secret (ACCESS_TOKEN_SECRET). That works only while every consumer is a Node
// service that can be handed the secret. A consumer written in another language
// -- or one we don't want holding a signing-capable secret -- needs asymmetric
// tokens plus a published public key.
//
// This module adds RS256 issuance WITHOUT removing the HS256 path. The active
// algorithm is chosen by JWT_SIGNING_ALG (default 'HS256'), so existing
// deployments are byte-for-byte unchanged until the flag is flipped.
//
// Env:
//   JWT_SIGNING_ALG        'HS256' (default) | 'RS256'
//   JWT_PRIVATE_KEY        RSA private key, PEM. Accepts a raw PEM, a PEM with
//                          literal \n escapes, or base64-encoded PEM.
//   JWT_PUBLIC_KEY         Optional. Derived from the private key when omitted.
//   JWT_PREVIOUS_PUBLIC_KEYS  Optional. Comma-separated additional public keys
//                          (PEM/base64) to keep publishing in the JWKS so tokens
//                          signed by a retired key still verify until they expire.
//   JWT_ISSUER             Optional `iss` claim stamped on RS256 tokens.
//
// Refresh tokens deliberately stay HS256/REFRESH_TOKEN_SECRET: they are only
// ever verified by Storm-Gate itself, so there is nothing for a third party to
// verify and no reason to widen the blast radius of this change.
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const DEFAULT_ALG = 'HS256';

// Normalize a key that arrived through an env var. Env plumbing mangles PEM
// newlines in a few predictable ways, so accept all of them rather than making
// the operator guess which one this deploy target uses.
function normalizePem(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let value = raw.trim();
  if (!value) return null;

  // Base64-encoded PEM (no BEGIN header visible until decoded).
  if (!value.includes('-----BEGIN')) {
    try {
      const decoded = Buffer.from(value, 'base64').toString('utf8');
      if (decoded.includes('-----BEGIN')) return decoded.trim();
    } catch {
      // fall through -- treated as malformed below
    }
    return null;
  }

  // Literal backslash-n escapes, as produced by most .env and secret managers.
  if (value.includes('\\n')) value = value.replace(/\\n/g, '\n');
  return value;
}

// RFC 7638 JWK thumbprint. Deterministic, so the `kid` is stable across
// restarts and across replicas without anyone having to configure it.
function thumbprint(jwk) {
  const canonical = JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n });
  return crypto.createHash('sha256').update(canonical).digest('base64url');
}

function toPublicJwk(publicKeyObject) {
  const jwk = publicKeyObject.export({ format: 'jwk' });
  return {
    kty: jwk.kty,
    n: jwk.n,
    e: jwk.e,
    alg: 'RS256',
    use: 'sig',
    kid: thumbprint(jwk),
  };
}

// Resolved once at module load. A key that is present but malformed is a
// configuration error we want to surface loudly at boot rather than as a
// per-request 401 storm.
let state = null;

function resolve() {
  if (state) return state;

  const alg = (process.env.JWT_SIGNING_ALG || DEFAULT_ALG).toUpperCase();

  // Distinguish "not configured" from "configured but unreadable". They need
  // different fixes, and reporting a garbled key as a missing one sends the
  // operator looking in the wrong place.
  const readKey = (name) => {
    const raw = process.env[name];
    const pem = normalizePem(raw);
    if (raw && raw.trim() && !pem) {
      throw new Error(
        `${name} is set but is not a valid PEM. Expected a PEM block, ` +
          'optionally base64-encoded or with literal \\n escapes.',
      );
    }
    return pem;
  };

  const privatePem = readKey('JWT_PRIVATE_KEY');
  const publicPemFromEnv = readKey('JWT_PUBLIC_KEY');

  const next = {
    alg,
    issuer: process.env.JWT_ISSUER || null,
    privateKey: null,
    activeJwk: null,
    jwks: { keys: [] },
    publicKeysByKid: new Map(),
  };

  const publicPems = [];
  if (privatePem) {
    let privateKey;
    try {
      privateKey = crypto.createPrivateKey(privatePem);
    } catch (err) {
      throw new Error(`JWT_PRIVATE_KEY is not a valid PEM private key: ${err.message}`);
    }
    if (privateKey.asymmetricKeyType !== 'rsa') {
      throw new Error(
        `JWT_PRIVATE_KEY must be an RSA key for RS256 (got ${privateKey.asymmetricKeyType}).`,
      );
    }
    next.privateKey = privateKey;
    publicPems.push(
      publicPemFromEnv ||
        crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }),
    );
  } else if (publicPemFromEnv) {
    // Verify-only deployment: no signing key, but still able to validate.
    publicPems.push(publicPemFromEnv);
  }

  for (const extra of (process.env.JWT_PREVIOUS_PUBLIC_KEYS || '').split(',')) {
    const pem = normalizePem(extra);
    if (pem) publicPems.push(pem);
  }

  publicPems.forEach((pem, index) => {
    let publicKey;
    try {
      publicKey = crypto.createPublicKey(pem);
    } catch (err) {
      throw new Error(`Invalid RSA public key at position ${index}: ${err.message}`);
    }
    const jwk = toPublicJwk(publicKey);
    if (next.publicKeysByKid.has(jwk.kid)) return;
    next.publicKeysByKid.set(jwk.kid, publicKey);
    next.jwks.keys.push(jwk);
    if (index === 0) next.activeJwk = jwk;
  });

  if (alg === 'RS256' && !next.privateKey) {
    throw new Error(
      'JWT_SIGNING_ALG=RS256 requires JWT_PRIVATE_KEY. ' +
        'Generate one with: node scripts/generate-jwt-keys.mjs',
    );
  }

  state = next;
  return state;
}

/** Re-read env. Test-only; production resolves once at boot. */
export function resetSigningKeys() {
  state = null;
}

/** True when access tokens should be signed RS256. */
export function isRs256Enabled() {
  return resolve().alg === 'RS256' && Boolean(resolve().privateKey);
}

/** True when at least one public key is published, regardless of signing alg. */
export function hasPublishedKeys() {
  return resolve().jwks.keys.length > 0;
}

/** The public JWKS document served at /.well-known/jwks.json. */
export function getJwks() {
  return { keys: resolve().jwks.keys.map((k) => ({ ...k })) };
}

/** Public KeyObject for a `kid`, or null when we don't publish that key. */
export function getPublicKeyByKid(kid) {
  return resolve().publicKeysByKid.get(kid) || null;
}

export function getIssuer() {
  return resolve().issuer;
}

/**
 * Sign an access token with whichever algorithm is currently active.
 * `options` mirrors jsonwebtoken's sign options (expiresIn, etc.).
 *
 * Every access token in the system -- user login, guest login, OIDC exchange --
 * goes through here so they all follow the same flag.
 */
export function signAccessToken(payload, options = {}) {
  const { key, options: signOptions } = getSignParams(options);
  return jwt.sign(payload, key, signOptions);
}

/** The (key, options) pair jsonwebtoken needs for the active algorithm. */
export function getSignParams(options = {}) {
  const { privateKey, issuer, activeJwk } = resolve();
  if (isRs256Enabled()) {
    const signOptions = { ...options, algorithm: 'RS256', keyid: activeJwk.kid };
    if (issuer && !signOptions.issuer) signOptions.issuer = issuer;
    return { key: privateKey, options: signOptions };
  }
  return {
    key: process.env.ACCESS_TOKEN_SECRET,
    options: { ...options, algorithm: 'HS256' },
  };
}
