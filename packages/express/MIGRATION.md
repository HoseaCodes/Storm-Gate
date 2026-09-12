# Migrating `@storm-gate/express` 0.1.0 → 0.2.0

**Short version:** 0.2.0 is a drop-in upgrade. Nothing breaks on install. The
work is in the *cutover* it enables, and that cutover has a strict order.

---

## Do you need to do anything?

No. Upgrading is a prerequisite for moving Storm-Gate to RS256 — it is not
maintenance you owe. If Storm-Gate keeps signing HS256, 0.1.0 keeps working
indefinitely.

Upgrade when you want one of these:

- A consumer that verifies tokens **without holding a signing-capable secret**.
  Under HS256 every verifier holds `ACCESS_TOKEN_SECRET`, which means every
  verifier can also *mint* tokens.
- A consumer written in another language, or one you don't fully control.
- Key rotation without redeploying every consumer's environment.

---

## What changed

### Nothing breaking

`createRequireAuth({ secret })` is byte-for-byte the same code path in 0.2.0 —
still synchronous, same 401 semantics, same `req.user`. The 0.1.0 test suite
passes unmodified against 0.2.0.

### Added

| | |
| --- | --- |
| `jwksUri` option | Verify RS256 tokens against Storm-Gate's published key set. |
| `issuer` / `audience` | Claim enforcement on RS256 tokens. |
| `cacheTtlMs` / `minRefreshMs` | JWKS cache tuning. |
| `fetchImpl` | Inject fetch for tests or a proxied egress. |
| `createJwksClient` | The caching key fetcher, for verifying outside a request pipeline. |
| HTTP **503** | New status, RS256 path only: the key set is unreachable. Distinguishes "auth server down" from "bad token" so clients retry instead of logging the user out. |

### Behaviour differences

- **`createRequireAuth()` with neither option still throws**, and the message
  still contains `secret`, so existing assertions hold.
- **The middleware is async when `jwksUri` is set.** Express handles both;
  this only matters if you call the middleware directly in a test. With
  `secret` alone it stays synchronous.

---

## Step 1 — Upgrade the package

> **The caret will not do this for you.** On a `0.x` version, `^0.1.0` does
> *not* admit `0.2.0`. `npm update` will report everything up to date and
> silently leave you on 0.1.0.

```sh
npm install @storm-gate/express@^0.2.0
```

Confirm what actually resolved:

```sh
node -p "require('@storm-gate/express/package.json').version"   # expect 0.2.0
```

Deploy this on its own. No config change, no behaviour change — it is a safe,
independently revertable deploy.

---

## Step 2 — Add `jwksUri` alongside `secret`

Pass **both**. This is the whole point of the migration window: the verifier
accepts HS256 *and* RS256, so it doesn't matter which one Storm-Gate is
currently issuing.

```diff
 const requireAuth = createRequireAuth({
   secret: process.env.ACCESS_TOKEN_SECRET,
+  jwksUri: `${process.env.STORM_GATE_URL}/.well-known/jwks.json`,
 });
```

Deploy. Still no behaviour change — Storm-Gate is issuing HS256, which the
`secret` path handles exactly as before. The JWKS is fetched lazily, on the
first RS256 token, so an empty key set costs nothing.

Verify the endpoint your consumer will call is reachable **from the consumer**,
not just from your laptop:

```sh
curl -s "$STORM_GATE_URL/.well-known/jwks.json"
# {"keys":[]}  <- correct at this stage; Storm-Gate has not flipped yet
```

---

## Step 3 — Generate and publish the key

On Storm-Gate:

```sh
node scripts/generate-jwt-keys.mjs           # or --base64 for single-line secret stores
```

Set `JWT_PRIVATE_KEY` in Storm-Gate's secret store. **Leave `JWT_SIGNING_ALG`
unset.** Storm-Gate now publishes the public key while still signing HS256:

```sh
curl -s "$STORM_GATE_URL/.well-known/jwks.json" | node -pe "JSON.parse(require('fs').readFileSync(0)).keys[0].kid"
```

A `kid` here means consumers can fetch the key before any token requires it.
Nothing is verifying RS256 yet, so this step is reversible by deleting the env var.

---

## Step 4 — Flip Storm-Gate to RS256

**Every consumer must be on step 2 before this.** A consumer still on 0.1.0 —
or on 0.2.0 without `jwksUri` — returns **401 on every authenticated route**
the moment it sees an RS256 token.

The failure is gradual, which makes it worse: outstanding 1-day HS256 tokens
keep working, so breakage appears over hours as users re-login, not immediately
at deploy.

```sh
JWT_SIGNING_ALG=RS256
JWT_ISSUER=https://auth.example.com   # optional but recommended
```

Restart Storm-Gate, then confirm what it is actually signing:

```sh
TOKEN=$(curl -s -X POST "$STORM_GATE_URL/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"...","password":"..."}' | node -pe "JSON.parse(require('fs').readFileSync(0)).accesstoken")

node -e "console.log(JSON.parse(Buffer.from(process.argv[1].split('.')[0],'base64url')))" "$TOKEN"
# { alg: 'RS256', typ: 'JWT', kid: '...' }   <- kid must match the JWKS
```

Then exercise a real protected route on each consumer with that token.

---

## Step 5 — Drop the shared secret

Wait out the access-token TTL — **1 day** — so every pre-flip HS256 token has
expired. Then, on each consumer:

```diff
 const requireAuth = createRequireAuth({
-  secret: process.env.ACCESS_TOKEN_SECRET,
   jwksUri: `${process.env.STORM_GATE_URL}/.well-known/jwks.json`,
+  issuer: process.env.STORM_GATE_URL,
 });
```

Now remove `ACCESS_TOKEN_SECRET` from the consumer's environment entirely, and
rotate it on Storm-Gate. This is the payoff: consumers can verify but no longer
mint.

Don't skip the wait. Dropping `secret` early rejects every still-valid HS256
session.

---

## Rolling back

| You are at | To roll back |
| --- | --- |
| Step 1–2 | Nothing to undo; no behaviour changed. |
| Step 3 | Unset `JWT_PRIVATE_KEY`. JWKS returns to `{"keys":[]}`. |
| Step 4 | Unset `JWT_SIGNING_ALG`. Safe **only while consumers still pass `secret`** — they keep accepting the RS256 tokens already in the wild alongside the new HS256 ones. |
| Step 5 | Not cleanly reversible. Restore `ACCESS_TOKEN_SECRET` on both sides and re-add `secret` before rolling Storm-Gate back. |

Because of that last row, treat step 5 as the point of no return and leave real
time between it and step 4.

---

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `401 Invalid authentication token` on every route right after the flip | A consumer is still on 0.1.0, or on 0.2.0 without `jwksUri`. Check the resolved version — `^0.1.0` does not upgrade to 0.2.0. |
| `401` with `code: 'UnknownSigningKey'` | The token's `kid` isn't in the published key set. Usually a rotated key where the old public key wasn't kept in `JWT_PREVIOUS_PUBLIC_KEYS`. |
| `503 JwksUnavailable` | The consumer can't reach `jwksUri`. Check egress and that the URL is right; the endpoint is unauthenticated, so a 401/403 here means a proxy, not Storm-Gate. |
| `401` on RS256 tokens, JWKS fetches fine | `issuer` is set on the consumer but `JWT_ISSUER` differs on Storm-Gate. They must match exactly. |
| Breakage appears hours after the flip, not immediately | Expected shape of the step-4 mistake — old HS256 tokens expiring. |
| `JWT_PRIVATE_KEY is set but is not a valid PEM` at boot | The key was mangled by the secret store. Use `--base64` output. |

---

## One change that lands without the flag

Independent of all of the above: Storm-Gate's own `auth` middleware now pins
`algorithms: ['HS256']`, where it previously passed no restriction. Tokens
signed with `HS384`/`HS512` using the shared secret were accepted before and
are rejected now.

Storm-Gate has never issued anything but HS256, and this package has always
pinned `['HS256']` on the verify side, so no token issued through the normal
flow is affected. It matters only if some app mints its own tokens with the
shared secret and an explicit non-default algorithm:

```sh
grep -rn "jwt.sign" --include=*.js . | grep -i algorithm
```

No hits, or no explicit `algorithm:`, means you're unaffected.
