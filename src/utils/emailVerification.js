// Email verification with a 6-digit code.
//
// Sign-up used to approve an address without checking it, so anyone could
// register with someone else's email, and password-reset mail then went to
// that address's real owner. New accounts now start unverified and are sent a
// code. Unverified accounts can still sign in; /me and the login response
// report `emailVerified` so each app decides what an unverified user may do.
//
// Accounts created before this existed have no `emailVerified` value and count
// as verified, so shipping this locks nobody out.
import crypto from 'crypto';

export const CODE_TTL_MS = 15 * 60 * 1000;
export const CODE_TTL_LABEL = '15 minutes';
export const MAX_CODE_ATTEMPTS = 5;

/** Verified unless explicitly marked false (legacy accounts have no value). */
export const isEmailVerified = (user) => user?.emailVerified !== false;

// A keyed hash, so a leaked database row does not reveal the code by trying
// all million possibilities.
function hashCode(code) {
  const secret = process.env.EMAIL_VERIFICATION_SECRET || process.env.ACCESS_TOKEN_SECRET || '';
  return crypto.createHmac('sha256', secret).update(String(code)).digest('hex');
}

/**
 * A fresh code plus the user fields that record it. The caller persists the
 * fields and emails the code.
 */
export function newVerificationCode(now = Date.now()) {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  return {
    code,
    fields: {
      emailVerified: false,
      emailVerificationCodeHash: hashCode(code),
      emailVerificationExpires: new Date(now + CODE_TTL_MS),
      emailVerificationAttempts: 0,
    },
  };
}

/**
 * Check `code` against the user's current one.
 * Returns 'verified', 'invalid' (wrong, expired, missing or used up) or
 * 'already-verified'. Mutates `user` to record the attempt or the success;
 * the caller saves it.
 */
export function checkVerificationCode(user, code, now = Date.now()) {
  if (isEmailVerified(user)) return 'already-verified';
  if (!user.emailVerificationCodeHash || !user.emailVerificationExpires) return 'invalid';
  if (new Date(user.emailVerificationExpires).getTime() <= now) return 'invalid';
  if ((user.emailVerificationAttempts ?? 0) >= MAX_CODE_ATTEMPTS) return 'invalid';

  user.emailVerificationAttempts = (user.emailVerificationAttempts ?? 0) + 1;

  const presented = Buffer.from(hashCode(typeof code === 'string' ? code.trim() : ''), 'hex');
  const stored = Buffer.from(user.emailVerificationCodeHash, 'hex');
  if (presented.length !== stored.length || !crypto.timingSafeEqual(presented, stored)) {
    return 'invalid';
  }

  markEmailVerified(user, now);
  return 'verified';
}

/** Record that the user has proven they own their address. */
export function markEmailVerified(user, now = Date.now()) {
  user.emailVerified = true;
  user.emailVerifiedAt = new Date(now);
  user.emailVerificationCodeHash = null;
  user.emailVerificationExpires = null;
  user.emailVerificationAttempts = 0;
}
