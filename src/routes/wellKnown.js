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
