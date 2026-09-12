<div align="center">
  <img alt="Storm-Gate" src="https://github.com/HoseaCodes/Storm-Gate/assets/66652422/0f4f708b-06bc-4ecd-a160-60ee6ea8dbf7">
  <br />
  <p><em>Fortifying authentication, unleashing confidence.</em></p>
</div>

[![CI](https://github.com/HoseaCodes/Storm-Gate/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/HoseaCodes/Storm-Gate/actions/workflows/ci.yml)
[![Release](https://github.com/HoseaCodes/Storm-Gate/actions/workflows/changelog.yml/badge.svg?branch=main)](https://github.com/HoseaCodes/Storm-Gate/actions/workflows/changelog.yml)
[![Node 20](https://img.shields.io/badge/Node-20.x-339933)](https://nodejs.org/)
[![Express 4](https://img.shields.io/badge/Express-4.19-000000)](https://expressjs.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-47A248)](https://www.mongodb.com/atlas)
[![AWS Lambda](https://img.shields.io/badge/AWS-Lambda-ff9900)](https://aws.amazon.com/lambda/)

A Node.js authentication service and the two SDKs that consume it. Storm-Gate issues
and verifies JWT access and refresh tokens, brokers Azure Entra ID sign-in, and
publishes its signing keys at `/.well-known/jwks.json` so consumers can verify tokens
without holding a secret that would also let them mint one.

It runs on AWS Lambda behind API Gateway with MongoDB Atlas, and also runs as a plain
Express process for local development.

> **Scope.** This is a working single-author service, not a framework or a reference
> implementation. The token and key-management code is covered by 85 tests and is the
> part worth reading; much of the surrounding surface — uploads, admin, user CRUD — has
> no automated coverage. [ARCHITECTURE.md](ARCHITECTURE.md) is candid about where the
> seams are, including a dependency audit that currently reports 3 critical and 30 high
> advisories in the production tree.

## What's in here

| Path | What it is |
| --- | --- |
| `src/` | The auth service — routes, controllers, token issuance, signing-key management |
| `packages/express/` | [`@storm-gate/express`](packages/express/README.md) — Express middleware that verifies Storm-Gate tokens |
| `packages/client/` | [`@storm-gate/client`](packages/client/README.md) — browser SDK for login, refresh, and cookie handling |
| `test/` | Service-level tests for token signing, JWT verification, and key discovery |

The service and the SDKs version independently. The service follows the repo's git
tags; each SDK carries its own npm version.

## Quickstart

### Verify Storm-Gate tokens in your own service

```sh
npm install @storm-gate/express jsonwebtoken
```

```js
import express from 'express';
import { createRequireAuth } from '@storm-gate/express';

const app = express();

// RS256: verifies locally against Storm-Gate's published public keys.
// No shared signing secret, no per-request callback.
const requireAuth = createRequireAuth({
  jwksUri: `${process.env.STORM_GATE_URL}/.well-known/jwks.json`,
  issuer: process.env.STORM_GATE_URL,
});

app.get('/api/articles', requireAuth, (req, res) => {
  res.json({ owner: req.user.id });   // req.user = { id, iat, exp }
});
```

Passing `secret` instead verifies HS256; passing both accepts either, which is what
you deploy during an HS256 → RS256 cutover. See
[`packages/express/README.md`](packages/express/README.md) for all three modes and
[`MIGRATION.md`](packages/express/MIGRATION.md) for the cutover sequence.

### Browser client

```sh
npm install @storm-gate/client axios
```

```js
import { createStormGateClient } from '@storm-gate/client';

const client = createStormGateClient({ baseUrl: process.env.STORM_GATE_URL });
await client.login({ email, password });
```

Full API in [`packages/client/README.md`](packages/client/README.md).

## Running the service

Requires Node 20 (see [`.nvmrc`](.nvmrc)) and a reachable MongoDB.

```sh
cp .env.example .env     # then fill it in
npm ci
npm run dev              # Express on PORT (default 3001)
npm run dev:lambda       # the Lambda handler locally
```

Swagger UI is served at `/api-docs`. Health check is `GET /health`.

With Docker instead:

```sh
make compose-up          # docker-compose, builds and runs
make test-local          # build, run detached, assert /health, tear down
```

## Configuration

Every variable is documented inline in [`.env.example`](.env.example), which is the
source of truth. The ones that change behaviour rather than just supplying credentials:

| Variable | Default | Effect |
| --- | --- | --- |
| `JWT_SIGNING_ALG` | `HS256` | `RS256` switches access tokens to asymmetric signing. Refresh tokens stay HS256 either way. |
| `JWT_PRIVATE_KEY` | — | RSA private key for RS256. Accepts raw PEM, base64 PEM, or PEM with `\n` escapes. Generate with `node scripts/generate-jwt-keys.mjs`. |
| `JWT_PREVIOUS_PUBLIC_KEYS` | — | Retired public keys kept in the JWKS so tokens signed by them verify until they expire. This is what makes key rotation non-breaking. |
| `JWT_ISSUER` | — | Stamped as `iss` on RS256 tokens. Consumers passing `issuer` must match it. |
| `CORS_ORIGINS` | `localhost:3000,3003` | Allowlist for credentialed cross-origin requests. **Must be set in production** or `/refresh_token` cookies will not round-trip. |

Leaving `JWT_SIGNING_ALG` unset while setting `JWT_PRIVATE_KEY` publishes the public
key *without* switching issuance — so consumers can move to RS256 verification before
the issuer changes.

## Commands

```sh
npm test                 # service tests (85, no secrets or database needed)
npm run test:packages    # SDK tests
npm run build:packages   # build both SDKs with tsup
npm run check:packages   # publint + are-the-types-wrong on the built output
npx changeset            # record an SDK change for release
```

## Branching and releases

```
feature ──PR──> staging ──PR──> main
                  │               │
                  v               v
            1.8.0-rc.1          1.8.0
            (prerelease)        (stable)
```

Features land on `staging`, which cuts `rc` prereleases. Promoting `staging` to `main`
cuts the stable release and publishes any SDKs with pending changesets.

- **PR titles must be conventional commits.** Squash merges use the title as the commit
  message, and the released version is derived from it. `feat:` is a minor bump,
  `fix:`/`perf:`/`refactor:` a patch, `docs:`/`chore:`/`ci:`/`test:` no release.
- **`staging` → `main` must be a merge commit, never a squash.** A squash creates a new
  commit, so `main` never contains `staging` and every later promotion re-conflicts.
  A back-merge PR opens automatically afterwards; merge that too.
- **SDK changes need a changeset** (`npx changeset`) or they publish nothing.

Version history lives in [CHANGELOG.md](CHANGELOG.md) and in GitHub Releases.

## Deployment

Deployment is currently a **manual, operator-run step** — there is no deploy workflow,
and no staging environment on AWS.

```sh
make lambda-deploy       # build, push to ECR, update Lambda + API Gateway
make lambda-logs-follow  # tail CloudWatch
```

The full runbook, including the native-module and image-size pitfalls, is in
[README-lambda.md](README-lambda.md). `deploy-lambda-complete.sh` takes
`LAMBDA_FUNCTION_NAME`, `ECR_REPOSITORY_NAME`, `IMAGE_TAG`, `API_STAGE_NAME`, and
`AWS_REGION` as environment overrides, so it can target more than one environment
without modification.

## Architecture and engineering notes

[ARCHITECTURE.md](ARCHITECTURE.md) covers the token model, why refresh tokens stay
symmetric, how algorithm-confusion attacks are rejected, the key-rotation drain window,
what the tests actually cover, and a frank list of known limitations.

## Contributing

Open a PR against `staging`. The PR template lists what CI checks. Both the `service`
and `build-and-test` jobs must pass.

## License

The service (`storm-gate`) declares **ISC**; both published SDKs declare **MIT**. There
is no `LICENSE` file in the repository yet, so treat the `license` field in each
`package.json` as authoritative until one is added.

## Contact

Dominique Hosea — [@DominiqueRHosea](https://twitter.com/DominiqueRHosea) ·
info@ambitiousconcept.com

[github.com/HoseaCodes/Storm-Gate](https://github.com/HoseaCodes/Storm-Gate)
