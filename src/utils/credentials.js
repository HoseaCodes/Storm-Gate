// Login used to answer "User does not exist." for unknown emails and "Invalid
// password" for known ones, and it skipped bcrypt entirely for unknown emails,
// so both the message and the response time told a caller which emails have an
// account. It also revealed DENIED status before checking the password.
//
// verifyCredentials always does one bcrypt comparison, whether or not the user
// exists, and callers answer every failure with the same message.
import bcrypt from 'bcrypt';

export const INVALID_CREDENTIALS = 'Invalid email or password';

// Rules for a password being set (sign-up or reset). Existing passwords are not
// re-checked at login, so raising the minimum locks nobody out.
export const PASSWORD_MIN_LENGTH = 8;
// bcrypt only reads the first 72 bytes and ignores the rest, so a longer
// password would silently be as strong as its first 72 bytes.
export const PASSWORD_MAX_BYTES = 72;

/** An error message for an unacceptable new password, or null if it is fine. */
export function validateNewPassword(password) {
  if (typeof password !== 'string' || !password) {
    return 'Password is required';
  }
  if ([...password].length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters long`;
  }
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    return `Password must be at most ${PASSWORD_MAX_BYTES} bytes long`;
  }
  return null;
}

// Same cost factor as registration (bcrypt.hash(password, 10)), so a comparison
// against it takes as long as one against a real stored hash.
const TIMING_COST = 10;
let timingHash;

async function getTimingHash() {
  timingHash ??= await bcrypt.hash('storm-gate-timing-equalizer', TIMING_COST);
  return timingHash;
}

/**
 * True only when `user` exists, has a password and `password` matches it.
 * Accounts without a local password (external sign-in) never match.
 */
export async function verifyCredentials(user, password) {
  const candidate = typeof password === 'string' ? password : '';
  if (!user || typeof user.password !== 'string' || !candidate) {
    await bcrypt.compare(candidate, await getTimingHash());
    return false;
  }
  return bcrypt.compare(candidate, user.password);
}
