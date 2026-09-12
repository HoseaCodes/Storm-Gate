# @storm-gate/express

## 0.2.0

### Minor Changes

- ede4d34: Add RS256 verification against Storm-Gate's published JWKS.

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

### Patch Changes

- 425184a: Fix TypeScript types resolution for CommonJS consumers.

  Both packages declared a single top-level `exports["."].types` pointing at
  `./dist/index.d.ts`. Because each package is `"type": "module"`, that
  declaration file is interpreted as ESM even when resolved through the
  `require` condition, so a TypeScript consumer on `moduleResolution: node16`
  or `bundler` using `require('@storm-gate/express')` got types that only
  worked under dynamic `import()`.

  The `exports` map now nests `types` under each of the `import` and `require`
  conditions, pointing `require` at the `./dist/index.d.cts` file tsup was
  already emitting. Runtime resolution is unchanged — this only affects which
  declaration file a type checker picks up.

  Verified with `publint --strict` and `attw --pack`, which now pass for
  node10, node16 (from CJS), node16 (from ESM), and bundler.
