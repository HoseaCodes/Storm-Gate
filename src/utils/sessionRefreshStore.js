// Issue, rotate and revoke sign-in refresh tokens (see models/sessionRefreshToken.js).
import crypto from 'crypto';
import SessionRefreshToken from '../models/sessionRefreshToken.js';

export const SESSION_REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

// Two refreshes racing with the same token (two tabs, a retried request) look
// like replay. Within this window a second use is refused without ending the
// session; after it, a second use is treated as theft.
export const REUSE_GRACE_MS = 30 * 1000;

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

async function store(userId, familyId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await SessionRefreshToken.create({
    tokenHash: hashToken(token),
    userId: String(userId),
    familyId,
    expiresAt: new Date(Date.now() + SESSION_REFRESH_TTL_SECONDS * 1000),
  });
  return token;
}

/** Start a new session family and return its first refresh token. */
export function issueRefreshToken(userId) {
  return store(userId, crypto.randomUUID());
}

/**
 * Exchange a refresh token for its successor.
 *
 * Resolves to { status: 'ok', userId, refreshToken } on success, or
 * { status: 'invalid' } for an unknown, expired or just-raced token, or
 * { status: 'reused' } when a spent token came back after the grace window --
 * in which case the whole family has been revoked.
 */
export async function rotateRefreshToken(token) {
  if (typeof token !== 'string' || !token) return { status: 'invalid' };

  const tokenHash = hashToken(token);
  const now = new Date();

  // Marking it used in the same operation as the read is what makes rotation
  // safe when two containers see the same token at once: only one wins.
  const entry = await SessionRefreshToken.findOneAndUpdate(
    { tokenHash, usedAt: null, expiresAt: { $gt: now } },
    { $set: { usedAt: now } },
    { new: false }
  ).lean();

  if (entry) {
    const refreshToken = await store(entry.userId, entry.familyId);
    return { status: 'ok', userId: entry.userId, refreshToken };
  }

  const spent = await SessionRefreshToken.findOne({ tokenHash }).lean();
  if (!spent || !spent.usedAt) return { status: 'invalid' };

  if (now.getTime() - new Date(spent.usedAt).getTime() <= REUSE_GRACE_MS) {
    return { status: 'invalid' };
  }

  await SessionRefreshToken.deleteMany({ familyId: spent.familyId });
  return { status: 'reused', userId: spent.userId };
}

/** End the session a refresh token belongs to. Unknown tokens are ignored. */
export async function revokeRefreshFamily(token) {
  if (typeof token !== 'string' || !token) return 0;
  const entry = await SessionRefreshToken.findOne({ tokenHash: hashToken(token) }).lean();
  if (!entry) return 0;
  const result = await SessionRefreshToken.deleteMany({ familyId: entry.familyId });
  return result?.deletedCount ?? 0;
}

/** End every session a user has, e.g. after a password reset. */
export async function revokeAllForUser(userId) {
  const result = await SessionRefreshToken.deleteMany({ userId: String(userId) });
  return result?.deletedCount ?? 0;
}

export { hashToken };
