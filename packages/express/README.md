# @storm-gate/express

Express middleware that verifies Storm-Gate-issued JWTs (HS256) and populates `req.user`.

## Install

```sh
npm install @storm-gate/express jsonwebtoken
```

`jsonwebtoken` and `express` are peer dependencies — you control the versions.

## Usage

```js
import express from 'express';
import { createRequireAuth } from '@storm-gate/express';

const app = express();
const requireAuth = createRequireAuth({
  secret: process.env.ACCESS_TOKEN_SECRET,
});

app.post('/api/articles', requireAuth, (req, res) => {
  // req.user = { id, iat, exp }
  res.json({ owner: req.user.id });
});
```

## API

### `createRequireAuth({ secret, algorithms? })`

Returns an Express middleware that:
- Reads the `Authorization` header — accepts both `Bearer <jwt>` and raw `<jwt>` formats.
- Verifies the token with the provided secret.
- Populates `req.user` with the decoded payload and calls `next()`.
- Returns **401** on missing, invalid, or expired tokens (the SDK normalizes Storm-Gate's 400-on-expired-token behavior).

Options:
- `secret` (string, required) — must match Storm-Gate's `ACCESS_TOKEN_SECRET`.
- `algorithms` (string[], default `['HS256']`) — accepted JWT algorithms.

## v0.1 limitations

- HS256 only. RS256/JWKS support is planned for v0.2.
- Storm-Gate's JWT payload currently contains only `{ id }`, so `req.user.role` is undefined. Role-based gating must be done by the consumer via a lookup keyed on `req.user.id`.
- No refresh-token verification — that endpoint is cookie-driven on Storm-Gate.

## License

ISC
