// Login used to answer "User does not exist." for unknown emails and "Invalid
// password" for known ones, and it skipped bcrypt entirely for unknown emails,
// so both the message and the response time told a caller which emails have an
// account. It also revealed DENIED status before checking the password.
//
// verifyCredentials always does one bcrypt comparison, whether or not the user
// exists, and callers answer every failure with the same message.
import bcrypt from 'bcrypt';

export const INVALID_CREDENTIALS = 'Invalid email or password';

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
