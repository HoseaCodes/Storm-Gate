/*
 * RFC 7591 Dynamic Client Registration.
 *
 * Deliberately absent until now. Clients were registered by an operator running
 * a script, on the reasoning that registration is rare and a standing
 * credential-minting endpoint is a liability. That reasoning holds for a client
 * we choose, like the MCP server.
 *
 * It does not hold for ChatGPT. A remote MCP client discovers this server from
 * metadata and expects to register itself: its redirect URI is generated per
 * connector and is not known in advance, so there is nothing an operator could
 * have pre-registered. Without this endpoint the connector cannot be created at
 * all.
 *
 * ## What this endpoint will and will not do
 *
 * It is **open** — no credential is required to call it, as RFC 7591 intends
 * for a public authorization server. What that grants is narrow: the ability to
 * create a client record that can *ask* an athlete for consent. It grants no
 * access to anything. Every registered client still has to be approved by the
 * person whose data it wants, and the scopes it may request are fixed here, not
 * chosen by the caller.
 *
 * The protections that matter are therefore on what a registration may contain:
 * redirect URIs are validated the same way the operator script validates them,
 * the audience is assigned rather than accepted, and scopes are intersected
 * with what this deployment actually offers.
 */
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import ServiceClient from '../models/serviceClient.js';
import { validateRedirectUri } from '../utils/clientRegistration.js';
import Logger from '../utils/logger-lambda.js';

/**
 * Scopes a self-registering client may ask for.
 *
 * Not taken from the request. A client registering itself may request these and
 * nothing else; the athlete then decides whether to grant them. Accepting an
 * arbitrary scope string would let a caller invent a permission name that no
 * consent screen explains.
 */
const logger = new Logger('oauth-register');

const REGISTERABLE_SCOPES = ['training:read', 'workouts:read', 'workouts:write'];

/** The audience every dynamically registered client receives. */
const DEFAULT_AUDIENCE = process.env.OAUTH_DEFAULT_AUDIENCE || 'manifestathletics-api';

function badRequest(res, description) {
  // RFC 7591 §3.2.2 error shape.
  return res.status(400).json({
    error: 'invalid_client_metadata',
    error_description: description,
  });
}

export async function register(req, res) {
  try {
    const body = req.body || {};
    const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];

    if (redirectUris.length === 0) {
      return badRequest(res, 'redirect_uris is required and must contain at least one URI');
    }
    if (redirectUris.length > 10) {
      return badRequest(res, 'redirect_uris may contain at most 10 URIs');
    }
    for (const uri of redirectUris) {
      const problem = validateRedirectUri(uri);
      if (problem) return badRequest(res, `Invalid redirect URI: ${problem}`);
    }

    /*
     * Intersected, not accepted. A caller asking for something this deployment
     * does not offer gets the subset that exists rather than a rejection: the
     * request is not malformed, it is merely optimistic, and refusing it would
     * fail registration over a scope the client may never use.
     */
    const requested = String(body.scope || '').split(/\s+/).filter(Boolean);
    const scopes = requested.length
      ? REGISTERABLE_SCOPES.filter((s) => requested.includes(s))
      : REGISTERABLE_SCOPES;

    if (scopes.length === 0) {
      return badRequest(
        res,
        `None of the requested scopes are offered here. Available: ${REGISTERABLE_SCOPES.join(' ')}`,
      );
    }

    const authMethod = body.token_endpoint_auth_method || 'client_secret_basic';
    const isConfidential = authMethod !== 'none';

    /*
     * A generated id, never one the caller chose.
     *
     * A caller-supplied client_id could collide with an operator-registered
     * client — or be chosen to impersonate one on a consent screen, where the
     * athlete sees a name and decides whether to trust it.
     */
    const clientId = `dcr-${crypto.randomBytes(12).toString('hex')}`;
    const clientSecret = isConfidential ? crypto.randomBytes(32).toString('base64url') : null;

    await ServiceClient.create({
      clientId,
      name: String(body.client_name || 'Unnamed client').slice(0, 120),
      description: String(body.client_uri || '').slice(0, 500),
      clientSecretHash: clientSecret ? await bcrypt.hash(clientSecret, 10) : undefined,
      redirectUris,
      audience: DEFAULT_AUDIENCE,
      // `allowedScopes`, not `scopes`. Mongoose drops an unknown field in
      // silence, so the wrong name registered a client permitted to request
      // nothing — and a client with no scopes is refused at /authorize without
      // ever reaching a consent screen or issuing a code.
      allowedScopes: scopes,
      isConfidential,
      status: 'active',
    });

    logger.info(`Dynamic client registration: ${clientId} (${body.client_name || 'unnamed'})`);

    const response = {
      client_id: clientId,
      client_name: body.client_name,
      redirect_uris: redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: authMethod,
      scope: scopes.join(' '),
      // Never expires, and there is no registration access token: this server
      // does not support the RFC 7592 management API, so advertising a way to
      // read the registration back would point at nothing.
      client_id_issued_at: Math.floor(Date.now() / 1000),
    };
    if (clientSecret) {
      response.client_secret = clientSecret;
      response.client_secret_expires_at = 0; // 0 means it does not expire.
    }

    return res.status(201).json(response);
  } catch (err) {
    logger.error(`Dynamic client registration failed: ${err.message}`);
    return res.status(500).json({ error: 'server_error' });
  }
}

export default { register };
export { REGISTERABLE_SCOPES };
