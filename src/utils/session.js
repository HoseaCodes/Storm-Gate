// HTTP side of sign-in sessions, shared by both auth controllers.
//
// Refresh tokens reach clients two ways:
//   - an httpOnly cookie (web), refreshed with GET .../refresh_token
//   - the JSON body, only when the request sends `includeRefreshToken: true`
//     (mobile), refreshed with POST /auth/refresh
// Returning them in every body would hand a 30-day credential to web pages that
// never asked for one (manifestfitness passes login responses to the browser).
import { createAccessToken } from './auth.js';
import {
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshFamily,
  SESSION_REFRESH_TTL_SECONDS,
} from './sessionRefreshStore.js';

export const REFRESH_COOKIE = 'refreshtoken';

// The cookie used to be scoped to /api/auth/refresh_token, a path no deployed
// route answers on, so browsers never sent it back. It is cleared there on
// logout so old copies do not linger.
const LEGACY_REFRESH_COOKIE_PATH = '/api/auth/refresh_token';

const refreshCookieOptions = () => ({
  httpOnly: true,
  path: '/',
  maxAge: SESSION_REFRESH_TTL_SECONDS * 1000,
  secure: process.env.NODE_ENV === 'production',
});

function readCookieToken(req) {
  const raw = req.cookies?.[REFRESH_COOKIE];
  return typeof raw === 'string' ? raw.replace(/^JWT\s/, '') : undefined;
}

/**
 * Tokens for a user who just signed in or signed up. A refresh token is only
 * created (and stored) when it will actually be handed out.
 */
export async function startSession(req, res, userId, { setCookie = false } = {}) {
  const accesstoken = createAccessToken({ id: userId });
  const wantsBody = req.body?.includeRefreshToken === true;
  if (!setCookie && !wantsBody) return { accesstoken };

  const refreshToken = await issueRefreshToken(userId);
  if (setCookie) res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
  return wantsBody ? { accesstoken, refreshToken } : { accesstoken };
}

/** GET .../refresh_token: rotate the cookie token, answer with a new access token. */
export async function refreshFromCookie(req, res) {
  const token = readCookieToken(req);
  if (!token) return res.status(400).json({ msg: 'Please Login or Register' });

  const result = await rotateRefreshToken(token);
  if (result.status !== 'ok') {
    res.clearCookie(REFRESH_COOKIE, { path: '/' });
    return res.status(400).json({ msg: 'Please Verify Info & Login or Register' });
  }

  res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions());
  return res.json({ accesstoken: createAccessToken({ id: result.userId }) });
}

/** POST /auth/refresh: rotate a body token, answer with a new pair. */
export async function refreshFromBody(req, res) {
  const result = await rotateRefreshToken(req.body?.refreshToken);
  if (result.status !== 'ok') {
    return res.status(401).json({ msg: 'Invalid or expired refresh token' });
  }
  return res.json({
    accesstoken: createAccessToken({ id: result.userId }),
    refreshToken: result.refreshToken,
  });
}

/** Logout: revoke the session behind whichever refresh token was presented. */
export async function endSession(req, res) {
  const tokens = new Set([req.body?.refreshToken, readCookieToken(req)].filter(Boolean));
  for (const token of tokens) await revokeRefreshFamily(token);

  res.clearCookie(REFRESH_COOKIE, { path: '/' });
  res.clearCookie(REFRESH_COOKIE, { path: LEGACY_REFRESH_COOKIE_PATH });
  return res.json({ msg: 'Logged Out', status: 'Successful' });
}
