# @storm-gate/express

Express middleware that verifies Storm-Gate-issued JWTs and populates `req.user`.

## Install

```sh
npm install @storm-gate/express jsonwebtoken
```

`jsonwebtoken` and `express` are peer dependencies — you control the versions.

## Versions

| | 0.1.0 | 0.2.0 |
| --- | --- | --- |
| HS256 via shared secret | ✅ | ✅ (unchanged) |
| RS256 via Storm-Gate's JWKS | — | ✅ |
| Both at once (migration window) | — | ✅ |
| `createJwksClient` export | — | ✅ |

0.2.0 adds RS256 and changes nothing else. Upgrading is safe on its own and is
**not** required unless you want to move Storm-Gate off shared secrets — see
[MIGRATION.md](./MIGRATION.md).

> On a `0.x` version, `^0.1.0` does **not** admit `0.2.0`. `npm update` will
> leave you on 0.1.0; install `@storm-gate/express@^0.2.0` explicitly.

---

## Usage

### HS256 — shared secret

Works in both 0.1.0 and 0.2.0, identically. The verifier holds
`ACCESS_TOKEN_SECRET`, which means it can also *mint* tokens — fine for a
service you fully control, and the reason RS256 exists for ones you don't.

```js
import express from 'express';
import { createRequireAuth } from '@storm-gate/express';

const app = express();
const requireAuth = createRequireAuth({
  secret: process.env.ACCESS_TOKEN_SECRET,   // must match Storm-Gate's
});

app.post('/api/articles', requireAuth, (req, res) => {
  // req.user = { id, iat, exp }
  res.json({ owner: req.user.id });
});
```

This path is synchronous and pinned to `['HS256']`.

### RS256 — JWKS *(0.2.0+)*

Verifies locally against Storm-Gate's published public keys. No shared signing
secret, and no per-request call back to Storm-Gate.

```js
const requireAuth = createRequireAuth({
  jwksUri: `${process.env.STORM_GATE_URL}/.well-known/jwks.json`,
  issuer: process.env.STORM_GATE_URL,   // must match Storm-Gate's JWT_ISSUER
});
```

Requires Storm-Gate to be running with `JWT_SIGNING_ALG=RS256`. Keys are fetched
lazily on the first RS256 token and cached for an hour.

### Both — the migration window *(0.2.0+)*

Accepts HS256 **and** RS256, so it doesn't matter which one Storm-Gate is
currently issuing. This is what you deploy *before* flipping Storm-Gate, and
what lets outstanding 1-day HS256 tokens drain after.

```js
const requireAuth = createRequireAuth({
  secret: process.env.ACCESS_TOKEN_SECRET,   // drop once pre-flip tokens expire
  jwksUri: `${process.env.STORM_GATE_URL}/.well-known/jwks.json`,
});
```

Full sequence, including rollback and troubleshooting: [MIGRATION.md](./MIGRATION.md).

---

## API

### `createRequireAuth(options)`

Returns an Express middleware that:

- Reads the `Authorization` header — accepts both `Bearer <jwt>` and raw `<jwt>`.
- Selects the verification key from the token header, then pins the allowed
  algorithm to the one that key can validate.
- Populates `req.user` with the decoded payload and calls `next()`.
- Returns **401** on missing, invalid, or expired tokens (the SDK normalizes
  Storm-Gate's 400-on-expired-token behaviour).
- Returns **503** when an RS256 token arrives and the key set cannot be
  fetched — a dependency failure, not a bad credential, so clients retry rather
  than discarding the session. *(0.2.0+)*

Requires at least one of `secret` or `jwksUri`.

| Option | Type | Default | Since | Notes |
| --- | --- | --- | --- | --- |
| `secret` | string | — | 0.1.0 | HS256 shared secret; must match Storm-Gate's `ACCESS_TOKEN_SECRET`. |
| `algorithms` | string[] | `['HS256']` | 0.1.0 | Accepted algorithms on the shared-secret path. |
| `jwksUri` | string | — | 0.2.0 | e.g. `https://auth.example.com/.well-known/jwks.json`. Enables RS256. |
| `issuer` | string | — | 0.2.0 | Required `iss` on RS256 tokens. |
| `audience` | string \| string[] | — | 0.2.0 | Required `aud` on RS256 tokens. |
| `cacheTtlMs` | number | `3600000` | 0.2.0 | JWKS cache lifetime. |
| `minRefreshMs` | number | `30000` | 0.2.0 | Floor between forced refetches on an unknown `kid`. |
| `fetchImpl` | function | `globalThis.fetch` | 0.2.0 | Override for tests or a proxied egress. |

The middleware is **synchronous** when only `secret` is given — identical to
0.1.0 — and **async** when `jwksUri` is set. Express handles both; the
difference only matters if you invoke the middleware directly in a test.

### `createJwksClient({ jwksUri, cacheTtlMs, minRefreshMs, fetchImpl })` *(0.2.0+)*

The caching key fetcher, exported for verifying tokens outside a request
pipeline (queue workers, cron jobs). `getKey(kid)` resolves to a Node
`KeyObject`, or `null` when the key set doesn't contain that `kid`.

```js
import { createJwksClient } from '@storm-gate/express';
import jwt from 'jsonwebtoken';

const jwks = createJwksClient({ jwksUri: `${STORM_GATE_URL}/.well-known/jwks.json` });

const { kid } = jwt.decode(token, { complete: true }).header;
const key = await jwks.getKey(kid);
const claims = jwt.verify(token, key, { algorithms: ['RS256'] });
```

---

## Behaviour notes

- **Algorithm pinning.** The token's own `alg` never selects key material
  unchecked. A token HMAC-signed with the published RSA public key — the
  classic RS256→HS256 confusion forgery — is rejected.
- **Key rotation.** An unknown `kid` triggers at most one JWKS refetch per
  `minRefreshMs`, so unknown-`kid` tokens can't be used to drive load at
  Storm-Gate.
- **Degraded auth server.** If a cache refresh fails but keys are already
  cached, the cached keys are used rather than failing every request.

## Limitations

- Storm-Gate's HS256 payload contains only `{ id }`, so `req.user.role` is
  undefined on that path. Tokens issued through the OIDC exchange carry
  `email`, `role`, and `application`.
- No refresh-token verification — that endpoint is cookie-driven on Storm-Gate,
  and refresh tokens remain HS256/internal by design.

## License

ISC
