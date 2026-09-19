// Persistence for the OIDC login flow.
//
// Replaces a process-local Map and a node-cache entry, which together were the
// only reason the OIDC routes could not run on Lambda.
import crypto from 'crypto';
import OidcAuthSession from '../models/oidcAuthSession.js';
import OidcRefreshToken from '../models/oidcRefreshToken.js';

/** Ten minutes, matching the sweep interval this replaces. */
const SESSION_TTL_MS = 10 * 60 * 1000;
const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export async function createAuthSession(state, { codeVerifier, application, returnUrl }) {
  await OidcAuthSession.create({
    stateHash: digest(state),
    codeVerifier,
    application: application || 'default',
    returnUrl: returnUrl || null,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
}

/**
 * Read and destroy a login session.
 *
 * findOneAndDelete makes `state` single-use atomically, across containers. The
 * previous code read the entry and deleted it later, leaving a window in which
 * the same state could be replayed -- which is the attack `state` exists to
 * prevent.
 */
export async function consumeAuthSession(state) {
  if (!state) return null;

  const entry = await OidcAuthSession.findOneAndDelete({ stateHash: digest(state) }).lean();
  if (!entry) return null;
  if (new Date(entry.expiresAt).getTime() <= Date.now()) return null;

  return {
    codeVerifier: entry.codeVerifier,
    application: entry.application,
    returnUrl: entry.returnUrl,
  };
}

/** Discard a session without consuming its result, e.g. on a failed exchange. */
export async function discardAuthSession(state) {
  if (!state) return;
  await OidcAuthSession.deleteOne({ stateHash: digest(state) });
}

/** One token per user: a new login replaces the previous one. */
export async function storeRefreshToken(userId, token) {
  await OidcRefreshToken.findOneAndUpdate(
    { userId: String(userId) },
    {
      $set: {
        tokenHash: digest(token),
        expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
      },
    },
    { upsert: true },
  );
}

/**
 * True when `token` is the refresh token currently on record for this user.
 *
 * Deliberately a predicate rather than a getter: the caller never handles the
 * stored value, so it cannot leak through a log line or an error message.
 */
export async function isCurrentRefreshToken(userId, token) {
  if (!token) return false;

  const entry = await OidcRefreshToken.findOne({ userId: String(userId) }).lean();
  if (!entry) return false;
  if (new Date(entry.expiresAt).getTime() <= Date.now()) return false;

  const expected = Buffer.from(entry.tokenHash, 'utf8');
  const actual = Buffer.from(digest(token), 'utf8');
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

export async function invalidateRefreshToken(userId) {
  await OidcRefreshToken.deleteOne({ userId: String(userId) });
}

export { SESSION_TTL_MS, REFRESH_TTL_SECONDS, digest };
