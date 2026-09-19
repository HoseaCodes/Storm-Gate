// Issue, rotate and revoke refresh tokens for delegated grants.
//
// Backed by MongoDB for the same reason as authCodeStore: an in-process cache
// loses every outstanding token on a Lambda cold start, and a token issued by
// one container is invisible to the next.
import crypto from 'crypto';
import ServiceRefreshToken from '../models/serviceRefreshToken.js';

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** Record a freshly issued refresh token. */
export async function storeRefreshToken(token, { userId, clientId, scopes, ttlSeconds }) {
  await ServiceRefreshToken.create({
    tokenHash: hashToken(token),
    userId: String(userId),
    clientId,
    scopes,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000),
  });
}

/**
 * Consume a refresh token, returning its record or null.
 *
 * Deleting as part of the read is what implements rotation: the presented
 * token is retired atomically, so a replay of the same token finds nothing even
 * if it arrives concurrently on another container.
 */
export async function consumeRefreshToken(token) {
  if (!token) return null;

  const entry = await ServiceRefreshToken.findOneAndDelete({ tokenHash: hashToken(token) }).lean();
  if (!entry) return null;
  if (new Date(entry.expiresAt).getTime() <= Date.now()) return null;

  return { userId: entry.userId, clientId: entry.clientId, scopes: entry.scopes };
}

/**
 * Drop every outstanding refresh token for a grant.
 *
 * Called on revocation so a withdrawn grant cannot be refreshed even once more.
 * Outstanding ACCESS tokens still run to expiry -- they are not revocable --
 * which is why their lifetime is kept short.
 */
export async function revokeTokensForGrant(userId, clientId) {
  const result = await ServiceRefreshToken.deleteMany({ userId: String(userId), clientId });
  return result?.deletedCount ?? 0;
}

export { hashToken };
