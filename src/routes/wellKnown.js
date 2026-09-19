// Public key discovery.
//
// These endpoints are what let a non-Node consumer (or any service we don't
// want holding a signing-capable secret) verify a Storm-Gate access token
// locally, instead of calling back to /me on every request.
//
// Both are deliberately unauthenticated -- a JWKS is public by definition; it
// contains only public keys.
import express from 'express';
import { getJwks, getIssuer } from '../utils/signingKeys.js';

const router = express.Router();

// Resolve the externally-visible base URL. JWT_ISSUER wins when set (it must
// match the `iss` claim we stamp on tokens); otherwise reconstruct from the
// request, honouring the proxy headers Fly/ALB set.
function baseUrl(req) {
  const configured = getIssuer();
  if (configured) return configured.replace(/\/$/, '');
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}`;
}

/**
 * @swagger
 * /.well-known/jwks.json:
 *   get:
 *     summary: Public signing keys (JWKS)
 *     description: >
 *       RFC 7517 key set for verifying Storm-Gate-issued RS256 access tokens.
 *       Returns an empty key set when Storm-Gate is configured for HS256 only.
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: JSON Web Key Set
 */
/**
 * @swagger
 * /.well-known/oauth-authorization-server:
 *   get:
 *     summary: OAuth 2.0 authorization server metadata (RFC 8414)
 *     description: >
 *       Lets a client discover the authorize and token endpoints, and confirm
 *       PKCE support, without being configured by hand.
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Authorization server metadata
 */
router.get('/.well-known/oauth-authorization-server', (req, res) => {
  const base = baseUrl(req);

  /*
   * Written because clients refuse to proceed without it.
   *
   * ChatGPT rejects a server whose metadata does not advertise
   * `code_challenge_methods_supported: ["S256"]` — correctly, since a client
   * cannot otherwise know that sending a code challenge will be honoured
   * rather than ignored. Without this document every consumer has to be told
   * the endpoints out of band, and a hand-typed endpoint is a hand-typed
   * mistake.
   *
   * `openid-configuration` already exists but predates delegated access: it
   * advertises `response_types_supported: ["token"]` and names no endpoints,
   * so it describes a server this one no longer is. It is left alone rather
   * than widened, because other consumers read it.
   *
   * Every value here is a claim about behaviour that exists. S256 is the only
   * challenge method `isSupportedChallengeMethod` accepts; `plain` is absent
   * because it is refused, not merely discouraged.
   */
  res.set('cache-control', 'public, max-age=3600');
  res.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    revocation_endpoint: `${base}/oauth/revoke`,
    jwks_uri: `${base}/.well-known/jwks.json`,

    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],

    // Credentials arrive in the form body; HTTP Basic is not read.
    token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],

    scopes_supported: ['training:read', 'workouts:read', 'workouts:write'],

    // Absent deliberately: there is no dynamic client registration. Clients are
    // registered by an operator, and advertising an endpoint that does not
    // exist would turn a clear "not supported" into a failed request.
  });
});

router.get('/.well-known/jwks.json', (req, res) => {
  // Keys are stable and rotation is operator-driven, so a long cache is safe
  // and keeps verifiers off this endpoint. `must-revalidate` bounds how long a
  // retired key can linger in a consumer's cache after a rotation.
  res.set('Cache-Control', 'public, max-age=3600, must-revalidate');
  res.json(getJwks());
});

/**
 * @swagger
 * /.well-known/openid-configuration:
 *   get:
 *     summary: Minimal OIDC discovery document
 *     description: >
 *       Enough of the discovery contract for standard OIDC verifier libraries
 *       to locate the JWKS automatically. Storm-Gate is not a full OP; this
 *       advertises token verification only.
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Discovery document
 */
router.get('/.well-known/openid-configuration', (req, res) => {
  const issuer = baseUrl(req);
  res.set('Cache-Control', 'public, max-age=3600, must-revalidate');
  res.json({
    issuer,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    id_token_signing_alg_values_supported: ['RS256'],
    response_types_supported: ['token'],
    subject_types_supported: ['public'],
    claims_supported: ['id', 'email', 'role', 'application', 'iss', 'exp', 'iat'],
  });
});

export default router;
