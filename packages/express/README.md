# @storm-gate/express

Express middleware that verifies Storm-Gate-issued JWTs and populates `req.user`.
Supports HS256 (shared secret) and RS256 (verified against Storm-Gate's published JWKS).

## Install

```sh
npm install @storm-gate/express jsonwebtoken
```

`jsonwebtoken` and `express` are peer dependencies — you control the versions.

## Usage

### HS256 (shared secret)

```js
import express from 'express';
import { createRequireAuth } from '@storm-gate/express';

const app = express();
const requireAuth = createRequireAuth({
  secret: process.env.ACCESS_TOKEN_SECRET,
});

app.post('/api/articles', requireAuth, (req, res) => {
  res.json({ owner: req.user.id });
});
```

### RS256 (JWKS)

Verifies locally against Storm-Gate's public keys — no shared signing secret, and
no per-request call back to Storm-Gate.

```js
const requireAuth = createRequireAuth({
  jwksUri: `${process.env.STORM_GATE_URL}/.well-known/jwks.json`,
  issuer: process.env.STORM_GATE_URL,
});
```

### Migrating HS256 → RS256

Pass **both** while Storm-Gate is cutting over. Tokens issued before the flip are
HS256 and stay valid until they expire (access tokens live 1 day), so a
JWKS-only verifier would reject live sessions.

```js
const requireAuth = createRequireAuth({
  secret: process.env.ACCESS_TOKEN_SECRET,   // drop once pre-flip tokens expire
  jwksUri: `${process.env.STORM_GATE_URL}/.well-known/jwks.json`,
});
```

Order of operations:

1. Deploy this version to every consumer with **both** options set.
2. Set `JWT_PRIVATE_KEY` + `JWT_SIGNING_ALG=RS256` on Storm-Gate and restart.
3. Wait out the access-token TTL (1 day).
4. Remove `secret` from consumers. Storm-Gate can then rotate `ACCESS_TOKEN_SECRET`
   out of every consumer's environment.

## API

### `createRequireAuth(options)`

Returns an Express middleware that:
- Reads the `Authorization` header — accepts both `Bearer <jwt>` and raw `<jwt>`.
- Selects the verification key from the token header, then pins the allowed
  algorithm to the one that key can validate.
- Populates `req.user` with the decoded payload and calls `next()`.
- Returns **401** on missing, invalid, or expired tokens (the SDK normalizes
  Storm-Gate's 400-on-expired-token behavior).
- Returns **503** when an RS256 token arrives and the key set cannot be fetched —
  a dependency failure, not a bad credential.

Requires at least one of `secret` or `jwksUri`.

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `secret` | string | — | HS256 shared secret; must match Storm-Gate's `ACCESS_TOKEN_SECRET`. |
| `jwksUri` | string | — | e.g. `https://auth.example.com/.well-known/jwks.json`. Enables RS256. |
| `algorithms` | string[] | `['HS256']` | Accepted algorithms on the shared-secret path. |
| `issuer` | string | — | Required `iss` on RS256 tokens. |
| `audience` | string \| string[] | — | Required `aud` on RS256 tokens. |
| `cacheTtlMs` | number | `3600000` | JWKS cache lifetime. |
| `minRefreshMs` | number | `30000` | Floor between forced refetches on an unknown `kid`. |
| `fetchImpl` | function | `globalThis.fetch` | Override for tests or a proxied egress. |

The middleware is synchronous when only `secret` is given, and async when
`jwksUri` is set. Express handles both.

### `createJwksClient({ jwksUri, ... })`

The caching key fetcher, exported for consumers that verify tokens outside a
request pipeline (queue workers, cron jobs). `getKey(kid)` resolves to a Node
`KeyObject` or `null`.

## Behaviour notes

- **Algorithm pinning.** The token's own `alg` never selects key material
  unchecked. A token HMAC-signed with the published RSA public key is rejected.
- **Key rotation.** An unknown `kid` triggers at most one JWKS refetch per
  `minRefreshMs`, so unknown-kid tokens can't be used to drive load at Storm-Gate.
- **Degraded auth server.** If a cache refresh fails but keys are already
  cached, the cached keys are used rather than failing every request.

## Limitations

- Storm-Gate's HS256 payload contains only `{ id }`, so `req.user.role` is
  undefined on that path. RS256 tokens issued through the OIDC exchange carry
  `email`, `role`, and `application`.
- No refresh-token verification — that endpoint is cookie-driven on Storm-Gate,
  and refresh tokens remain HS256/internal by design.

## License

ISC
