// Rate limits for the public auth routes, counted in MongoDB so they hold
// across Lambda containers (see models/rateLimitWindow.js).
//
// Two kinds of key:
//   - per client IP. On Lambda, req.ip is API Gateway's sourceIp (serverless-
//     http sets it as the socket address and `trust proxy` is off, so a client
//     cannot spoof it with X-Forwarded-For). Some apps call Storm Gate from
//     their servers (manifestfitness, ambitious-admin), so all their users
//     share a few IPs; per-IP limits are therefore generous.
//   - per email, which is what actually stops guessing one account's password
//     from many addresses. Emails are hashed so the collection holds no PII.
//
// Fixed windows: a caller can spend a window's allowance at its end and again
// at the start of the next, so a short burst can reach twice the limit.
// Accepted; the job is to stop scripts, not to meter precisely.
//
// Fails open: if MongoDB is unreachable the request is allowed and the failure
// logged. These routes need the database anyway, and denying everything when
// the counter store hiccups would turn a blip into an outage.
import crypto from 'crypto';
import RateLimitWindow from '../models/rateLimitWindow.js';

const MINUTE = 60 * 1000;

export async function checkRateLimit(key, limit, windowMs, now = Date.now()) {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const resetAt = windowStart + windowMs;
  const retryAfterSec = Math.max(1, Math.ceil((resetAt - now) / 1000));

  const row = await RateLimitWindow.findOneAndUpdate(
    { _id: `${key}:${windowStart}` },
    { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(resetAt) } },
    { upsert: true, new: true }
  ).lean();

  const count = row?.count ?? 1;
  return { allowed: count <= limit, limit, remaining: Math.max(0, limit - count), retryAfterSec };
}

const clientIp = (req) => req.ip || req.socket?.remoteAddress || 'unknown';

function emailKey(req) {
  const email = req.body?.email;
  if (typeof email !== 'string' || !email.trim()) return null;
  return crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

/**
 * Express middleware enforcing every rule in `rules`. Each rule is
 * { scope: 'ip' | 'email', limit, windowMs }. Requests with no email skip the
 * email rules (the handler rejects them anyway).
 */
export function rateLimit(name, rules, { log = console } = {}) {
  return async function rateLimitMiddleware(req, res, next) {
    try {
      for (const rule of rules) {
        const subject = rule.scope === 'email' ? emailKey(req) : clientIp(req);
        if (!subject) continue;

        const result = await checkRateLimit(`${name}:${rule.scope}:${subject}`, rule.limit, rule.windowMs);
        if (!result.allowed) {
          res.set('Retry-After', String(result.retryAfterSec));
          return res.status(429).json({ msg: 'Too many requests. Please try again later.' });
        }
      }
    } catch (err) {
      log.error(`Rate limit store unavailable for ${name}; allowing request`, {
        message: err?.message,
      });
    }
    return next();
  };
}

// One instance per action, shared by every route that performs it, so
// /login and /auth/login draw from the same allowance.
export const authLimits = {
  login: rateLimit('login', [
    { scope: 'ip', limit: 60, windowMs: 15 * MINUTE },
    { scope: 'email', limit: 10, windowMs: 15 * MINUTE },
  ]),
  register: rateLimit('register', [{ scope: 'ip', limit: 20, windowMs: 60 * MINUTE }]),
  forgotPassword: rateLimit('forgot-password', [
    { scope: 'ip', limit: 20, windowMs: 60 * MINUTE },
    { scope: 'email', limit: 5, windowMs: 60 * MINUTE },
  ]),
  resetPassword: rateLimit('reset-password', [{ scope: 'ip', limit: 30, windowMs: 15 * MINUTE }]),
  // Pending-approval pages poll this every 10 seconds from the browser.
  checkStatus: rateLimit('check-status', [{ scope: 'ip', limit: 200, windowMs: 15 * MINUTE }]),
  // Each call writes a guest record.
  guestLogin: rateLimit('guest-login', [{ scope: 'ip', limit: 30, windowMs: 60 * MINUTE }]),
  refresh: rateLimit('refresh', [{ scope: 'ip', limit: 120, windowMs: 15 * MINUTE }]),
  // Each code also allows only 5 attempts; this caps guessing across new codes.
  verifyEmail: rateLimit('verify-email', [
    { scope: 'ip', limit: 30, windowMs: 15 * MINUTE },
    { scope: 'email', limit: 10, windowMs: 15 * MINUTE },
  ]),
  resendVerification: rateLimit('resend-verification', [
    { scope: 'ip', limit: 20, windowMs: 60 * MINUTE },
    { scope: 'email', limit: 3, windowMs: 60 * MINUTE },
  ]),
};
