// OAuth 2.1 authorization-code flow for delegated service access.
//
// This is how a user authorises a service -- an MCP server an assistant talks
// to, a scheduled job, any third party -- to act on their behalf. The token it
// issues names both parties: `sub` is the user, `act.sub` is the service acting
// for them.
//
// Storm-Gate is the only party that can assert that delegation, which is why it
// lives here rather than in a consuming application.
//
// Nothing in this file is specific to any one consuming application. Scope
// vocabulary and token audience are properties of the registered client, so a
// fitness API, a blog and a storefront can each define their own without this
// controller knowing about any of them.
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import ServiceClient from '../models/serviceClient.js';
import ServiceGrant from '../models/serviceGrant.js';
import Logger from '../utils/logger-lambda.js';
import { signAccessToken } from '../utils/signingKeys.js';
import { verifyPkce, isSupportedChallengeMethod } from '../utils/pkce.js';
import { issueCode, consumeCode } from '../utils/authCodeStore.js';
import {
  storeRefreshToken,
  consumeRefreshToken,
  revokeTokensForGrant,
} from '../utils/serviceRefreshStore.js';

const logger = new Logger('oauth');

// Short, because revocation is enforced at refresh rather than at use: this is
// the worst-case window during which a revoked grant still works.
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

function parseScopes(raw) {
  if (!raw) return [];
  return String(raw).split(/[\s+]+/).filter(Boolean);
}

/**
 * Redirect-URI matching: exact string equality against the registered set.
 *
 * Not a prefix check, not an origin check, not a normalised comparison.
 * `https://app.test/cb` must not match `https://app.test/cb/../evil`, and
 * anything clever enough to "helpfully" normalise is a bypass waiting to be
 * found. This codebase has already shipped one unvalidated redirect.
 */
function isRegisteredRedirectUri(client, redirectUri) {
  if (!redirectUri || typeof redirectUri !== 'string') return false;
  return client.redirectUris.includes(redirectUri);
}

/** Append OAuth error parameters to an already-validated redirect URI. */
function redirectWithError(res, redirectUri, state, error, description) {
  const url = new URL(redirectUri);
  url.searchParams.set('error', error);
  if (description) url.searchParams.set('error_description', description);
  if (state) url.searchParams.set('state', state);
  return res.redirect(url.toString());
}

/**
 * GET /oauth/authorize
 *
 * Requires an authenticated user: mount behind the existing auth middleware
 * so `req.user` is populated.
 *
 * Error handling splits deliberately. A bad `client_id` or an unregistered
 * `redirect_uri` is answered with a flat 400 and NO redirect -- redirecting
 * those would hand control of the destination to the attacker, which is the
 * exact defect being fixed elsewhere in this codebase. Everything after those
 * two checks may safely redirect, because the destination is now known-good.
 */
async function authorize(req, res) {
  try {
    const {
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: responseType,
      scope,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod,
    } = req.query;

    const userId = req.user?.id || req.user?._id || req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'authentication_required' });
    }

    if (!clientId) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'client_id is required' });
    }

    const client = await ServiceClient.findOne({ clientId, status: 'active' });
    if (!client) {
      logger.error(`Authorization refused: unknown or disabled client ${clientId}`);
      return res.status(400).json({ error: 'invalid_client' });
    }

    if (!isRegisteredRedirectUri(client, redirectUri)) {
      logger.error(`Authorization refused: unregistered redirect_uri for client ${clientId}`);
      return res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri is not registered' });
    }

    // --- Past this point the redirect target is trusted, so errors may redirect.

    if (responseType !== 'code') {
      return redirectWithError(res, redirectUri, state, 'unsupported_response_type');
    }

    if (!isSupportedChallengeMethod(codeChallengeMethod) || !codeChallenge) {
      return redirectWithError(res, redirectUri, state, 'invalid_request', 'PKCE with S256 is required');
    }

    const requested = parseScopes(scope);
    if (requested.length === 0) {
      return redirectWithError(res, redirectUri, state, 'invalid_scope', 'At least one scope is required');
    }

    // The client's registered allowedScopes is the whole scope vocabulary here.
    // Storm-Gate has no opinion about what any particular scope means; it only
    // enforces that a client cannot request beyond what it was registered for,
    // whatever the user might be willing to approve.
    const beyondCeiling = requested.filter((s) => !client.allowedScopes.includes(s));
    if (beyondCeiling.length > 0) {
      return redirectWithError(res, redirectUri, state, 'invalid_scope', `Not permitted for this client: ${beyondCeiling.join(', ')}`);
    }

    // An existing grant that already covers everything requested is re-used
    // silently. A request for anything wider must go back to the user.
    const grant = await ServiceGrant.findOne({ userId, clientId, status: 'active' });
    const alreadyGranted = grant && requested.every((s) => grant.scopes.includes(s));

    if (!alreadyGranted) {
      // Consent is required. The caller renders this; POST /oauth/authorize/decision
      // completes the flow. Returned as data rather than HTML so the consent UI
      // can live in whichever app owns the user-facing experience.
      return res.status(200).json({
        consent_required: true,
        client: { clientId: client.clientId, name: client.name, description: client.description },
        requested_scopes: requested,
        already_granted_scopes: grant ? grant.scopes : [],
      });
    }

    const code = await issueCode({
      clientId,
      userId: String(userId),
      redirectUri,
      scopes: requested,
      codeChallenge,
    });

    const url = new URL(redirectUri);
    url.searchParams.set('code', code);
    if (state) url.searchParams.set('state', state);
    return res.redirect(url.toString());
  } catch (err) {
    logger.error(`Authorization failed: ${err.message}`);
    return res.status(500).json({ error: 'server_error' });
  }
}

/**
 * POST /oauth/token
 *
 * Confidential clients authenticate with client_secret. Public clients rely on
 * PKCE alone -- which is why PKCE is mandatory rather than optional.
 */
async function token(req, res) {
  try {
    const grantType = req.body?.grant_type;

    if (grantType === 'authorization_code') return exchangeCode(req, res);
    if (grantType === 'refresh_token') return refresh(req, res);

    return res.status(400).json({ error: 'unsupported_grant_type' });
  } catch (err) {
    logger.error(`Token request failed: ${err.message}`);
    return res.status(500).json({ error: 'server_error' });
  }
}

/** Authenticate the client, or null when it fails. */
async function authenticateClient(req) {
  const clientId = req.body?.client_id;
  const clientSecret = req.body?.client_secret;
  if (!clientId) return null;

  const client = await ServiceClient.findOne({ clientId, status: 'active' });
  if (!client) return null;

  if (client.isConfidential) {
    if (!clientSecret) return null;
    const ok = await bcrypt.compare(String(clientSecret), client.clientSecretHash);
    if (!ok) return null;
  }
  return client;
}

async function exchangeCode(req, res) {
  const client = await authenticateClient(req);
  if (!client) {
    return res.status(401).json({ error: 'invalid_client' });
  }

  const entry = await consumeCode(req.body?.code);
  if (!entry) {
    // Covers unknown, expired and already-redeemed codes alike. Distinguishing
    // them would tell an attacker whether a guessed code ever existed.
    return res.status(400).json({ error: 'invalid_grant' });
  }

  // A code is bound to the client that requested it. Without this check, a
  // leaked code could be redeemed by any other registered client.
  if (entry.clientId !== client.clientId) {
    logger.error(`Code redemption refused: client mismatch for ${client.clientId}`);
    return res.status(400).json({ error: 'invalid_grant' });
  }

  // RFC 6749 §4.1.3: redirect_uri must match the authorize request.
  if (req.body?.redirect_uri !== entry.redirectUri) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
  }

  if (!verifyPkce(req.body?.code_verifier, entry.codeChallenge, 'S256')) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
  }

  // The grant is re-read rather than trusted from the code: a user may have
  // revoked in the seconds between authorising and redeeming.
  const grant = await ServiceGrant.findOne({
    userId: entry.userId,
    clientId: entry.clientId,
    status: 'active',
  });
  if (!grant) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'No active grant' });
  }

  // Narrow to what is still granted, in case the grant shrank.
  const scopes = entry.scopes.filter((s) => grant.scopes.includes(s));
  if (scopes.length === 0) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'No granted scopes remain' });
  }

  return issueTokens(res, { userId: entry.userId, client, scopes, grant });
}

async function refresh(req, res) {
  const client = await authenticateClient(req);
  if (!client) {
    return res.status(401).json({ error: 'invalid_client' });
  }

  const presented = req.body?.refresh_token;
  if (!presented) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  // Consuming the token IS the rotation: it is retired atomically as it is
  // read, so a replay finds nothing even on another container.
  const record = await consumeRefreshToken(presented);
  if (!record) {
    return res.status(400).json({ error: 'invalid_grant' });
  }

  if (record.clientId !== client.clientId) {
    logger.error(`Refresh refused: client mismatch for ${client.clientId}`);
    return res.status(400).json({ error: 'invalid_grant' });
  }

  // Where revocation actually takes effect. Access tokens cannot be revoked, so
  // the grant is re-read on every refresh and a revoked grant ends the session
  // here -- bounded by one access-token lifetime.
  const grant = await ServiceGrant.findOne({
    userId: record.userId,
    clientId: client.clientId,
    status: 'active',
  });
  if (!grant) {
    logger.info(`Refresh refused: grant revoked for client ${client.clientId}`);
    return res.status(400).json({ error: 'invalid_grant', error_description: 'Grant has been revoked' });
  }

  const scopes = record.scopes.filter((s) => grant.scopes.includes(s));
  if (scopes.length === 0) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'No granted scopes remain' });
  }

  return issueTokens(res, { userId: record.userId, client, scopes, grant });
}

async function issueTokens(res, { userId, client, scopes, grant }) {
  const jti = crypto.randomUUID();

  const accessToken = signAccessToken(
    {
      sub: String(userId),
      // Emitted alongside `sub` because existing consumers read `id`. Remove
      // once every consumer has migrated to `sub`.
      id: String(userId),
      act: { sub: client.clientId },
      scope: scopes.join(' '),
    },
    {
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      audience: client.audience,
      jwtid: jti,
    },
  );

  // Opaque rather than a JWT: the authoritative record is the stored row, so a
  // self-describing token would add a second source of truth that could
  // disagree with it. Nothing reads a refresh token except this service.
  const refreshToken = crypto.randomBytes(32).toString('base64url');
  await storeRefreshToken(refreshToken, {
    userId,
    clientId: client.clientId,
    scopes,
    ttlSeconds: REFRESH_TOKEN_TTL_SECONDS,
  });

  grant.lastUsedAt = new Date();
  await grant.save();

  return res.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: scopes.join(' '),
  });
}

/**
 * POST /oauth/authorize/decision
 * Records the user's consent decision and completes the flow.
 */
async function decision(req, res) {
  try {
    const userId = req.user?.id || req.user?._id || req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'authentication_required' });

    const {
      client_id: clientId,
      redirect_uri: redirectUri,
      scope,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod,
      approved,
      consent_version: consentVersion,
    } = req.body || {};

    const client = await ServiceClient.findOne({ clientId, status: 'active' });
    if (!client) return res.status(400).json({ error: 'invalid_client' });
    if (!isRegisteredRedirectUri(client, redirectUri)) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri is not registered' });
    }
    if (!isSupportedChallengeMethod(codeChallengeMethod) || !codeChallenge) {
      return redirectWithError(res, redirectUri, state, 'invalid_request', 'PKCE with S256 is required');
    }

    if (!approved) {
      return redirectWithError(res, redirectUri, state, 'access_denied');
    }

    const requested = parseScopes(scope).filter((s) => client.allowedScopes.includes(s));
    if (requested.length === 0) {
      return redirectWithError(res, redirectUri, state, 'invalid_scope');
    }

    await ServiceGrant.findOneAndUpdate(
      { userId, clientId },
      {
        $set: {
          scopes: requested,
          status: 'active',
          revokedAt: null,
          consentVersion: consentVersion || null,
        },
        $setOnInsert: { userId, clientId, grantedAt: new Date() },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    const code = await issueCode({
      clientId,
      userId: String(userId),
      redirectUri,
      scopes: requested,
      codeChallenge,
    });

    const url = new URL(redirectUri);
    url.searchParams.set('code', code);
    if (state) url.searchParams.set('state', state);
    return res.redirect(url.toString());
  } catch (err) {
    logger.error(`Consent decision failed: ${err.message}`);
    return res.status(500).json({ error: 'server_error' });
  }
}

/** POST /oauth/revoke — the user withdraws a grant. */
async function revoke(req, res) {
  try {
    const userId = req.user?.id || req.user?._id || req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'authentication_required' });

    const clientId = req.body?.client_id;
    if (!clientId) return res.status(400).json({ error: 'invalid_request' });

    const grant = await ServiceGrant.findOneAndUpdate(
      { userId, clientId },
      { $set: { status: 'revoked', revokedAt: new Date() } },
      { new: true },
    );
    if (!grant) return res.status(404).json({ error: 'not_found' });

    // Drop outstanding refresh tokens too, so a revoked grant cannot be
    // refreshed even once more.
    const dropped = await revokeTokensForGrant(userId, clientId);
    logger.info(`Grant revoked for client ${clientId}; ${dropped} refresh token(s) dropped`);
    // Outstanding access tokens remain valid until they expire; they are not
    // revocable, which is why their lifetime is short.
    return res.json({ status: 'revoked', clientId, accessTokensExpireWithinSeconds: ACCESS_TOKEN_TTL_SECONDS });
  } catch (err) {
    logger.error(`Revocation failed: ${err.message}`);
    return res.status(500).json({ error: 'server_error' });
  }
}

/** GET /oauth/grants — connected apps for the user. */
async function listGrants(req, res) {
  try {
    const userId = req.user?.id || req.user?._id || req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'authentication_required' });

    const grants = await ServiceGrant.find({ userId, status: 'active' }).lean();

    // Join the client records for display names. A connected-apps screen
    // showing a raw clientId asks someone to recognise an internal identifier,
    // which is exactly the moment they cannot tell a legitimate integration
    // from one they should remove.
    const clients = await ServiceClient.find({
      clientId: { $in: grants.map((g) => g.clientId) },
    })
      .select('clientId name description')
      .lean();
    const byId = new Map(clients.map((c) => [c.clientId, c]));

    return res.json({
      grants: grants.map((g) => {
        const client = byId.get(g.clientId);
        return {
          clientId: g.clientId,
          // Falls back to the id when a client has since been deleted: the
          // grant still exists and must remain revocable.
          name: client?.name || g.clientId,
          description: client?.description || null,
          scopes: g.scopes,
          grantedAt: g.grantedAt,
          lastUsedAt: g.lastUsedAt,
        };
      }),
    });
  } catch (err) {
    logger.error(`Listing grants failed: ${err.message}`);
    return res.status(500).json({ error: 'server_error' });
  }
}

export default { authorize, decision, token, revoke, listGrants };
export { isRegisteredRedirectUri, parseScopes, ACCESS_TOKEN_TTL_SECONDS };
