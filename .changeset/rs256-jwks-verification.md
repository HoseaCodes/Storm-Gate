---
"@storm-gate/express": minor
---

Add RS256 verification against Storm-Gate's published JWKS.

`createRequireAuth` now accepts `jwksUri` (plus `issuer`, `audience`,
`cacheTtlMs`, `minRefreshMs`, `fetchImpl`) and verifies RS256 tokens locally
against the fetched key set. Passing `secret` and `jwksUri` together accepts
both algorithms, which is what a consumer needs during the HS256 → RS256
cutover window.

The verification key is selected from the token header and the allowed
algorithm is then pinned to that key, so a token HMAC-signed with the published
public key is rejected rather than accepted.

Existing `createRequireAuth({ secret })` usage is unchanged and still
synchronous.
