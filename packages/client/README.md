# @storm-gate/client

Browser SDK for the [Storm-Gate](https://github.com/HoseaCodes/Storm-Gate) auth service. Replaces hand-rolled axios + cookie + JWT plumbing in consumer apps.

## Install

```sh
npm install @storm-gate/client axios
```

`axios` is a peer dependency — you control the version.

## Quickstart

```js
import { createStormGateClient } from '@storm-gate/client';

export const auth = createStormGateClient({
  baseURL: process.env.REACT_APP_STORM_GATE_URL,
  rememberMeMaxAge: 7 * 24 * 3600,
  defaultMaxAge: 24 * 3600,
  isAuthRequiredRoute: (pathname) => pathname.startsWith('/admin'),
  onUnauthenticated: () => { window.location.href = '/login'; },
});

await auth.login({ email, password, rememberMe: true });
const { user } = await auth.getMe();          // /login does not return user — call /me separately
await auth.logout();

// For your OWN backend, with the same cookie token attached:
const api = auth.createAuthedAxios({ baseURL: process.env.REACT_APP_LOCAL_API_URL });
await api.get('/articles');
```

## API

### `createStormGateClient(options)`

Options:
- `baseURL` (string, required) — Storm-Gate base URL.
- `cookieName` (string, default `'accesstoken'`) — cookie name for the access token.
- `rememberMeMaxAge` (seconds, default `7 * 24 * 3600`) — cookie TTL when `rememberMe: true`.
- `defaultMaxAge` (seconds, default `24 * 3600`) — cookie TTL otherwise.
- `isAuthRequiredRoute` (`(pathname) => boolean`, default returns false) — controls whether a normalized 401 fires `onUnauthenticated`.
- `onUnauthenticated` (`() => void`, optional) — called once per session when an authed request fails.
- `strictNormalization` (boolean, default `false`) — when `true`, skips the 400→401 heuristic and only treats real 401s as auth failures.

Methods returned:
- `login({ email, password, rememberMe? })` → `{ accesstoken, status, limitedAccess? }`
- `register({ name, email, password, role?, application?, status? })` → `{ accesstoken?, status, requiresApproval?, msg? }`
- `getMe()` → `{ status, user }`
- `logout()` → `{ msg, status }`
- `refreshToken()` → `{ accesstoken }`
- `checkStatus({ email })` → `{ status, user }`
- `forgotPassword({ email })` → `{ msg, status }`
- `verifyResetToken(token)` → `{ msg, status, email }` — token is in URL path
- `resetPassword({ token, password })` → `{ msg, status }` — token is in URL path
- `createAuthedAxios({ baseURL, ...config })` → axios instance that auto-attaches the same cookie token

## Behavior notes

- **Header format:** the SDK sends `Authorization: <jwt>` (no `Bearer` prefix). Storm-Gate accepts both.
- **400→401 normalization:** Storm-Gate currently returns 400 (not 401) for expired or invalid tokens. The SDK normalizes these so `error.response.status === 401` for callers. Login/register are excluded from this heuristic since their 400s are business errors. Disable with `strictNormalization: true`.
- **Cross-origin:** the SDK uses `withCredentials: true` so the HttpOnly `refreshtoken` cookie can roundtrip on `refreshToken()`. Requires Storm-Gate's CORS config to allowlist your origin with `credentials: true`.
- **`auth.login()` does NOT return `user`.** Storm-Gate's `/login` response omits it; call `auth.getMe()` after if you need it.

## v0.1 limitations

- HS256 only. RS256/JWKS coming in v0.2.
- Browser only — no SSR / Node cookie support. Will throw if `document` is not available.
- No silent refresh loop — call `refreshToken()` manually when needed.

## License

ISC
