// Issue and redeem single-use authorization codes.
//
// Backed by MongoDB rather than process memory: Storm-Gate's production
// entrypoint is Lambda behind API Gateway, where /authorize and /token
// routinely execute in different containers. See src/models/authorizationCode.js
// for the full reasoning.
import crypto from 'crypto';
import AuthorizationCode from '../models/authorizationCode.js';

/*
 * Five minutes.
 *
 * It was sixty seconds, which is shorter than the round trip some clients
 * actually make. A redirect delivers the code to the client's *browser*, and
 * the exchange is then performed by the client's *backend* — across a redirect
 * chain, a queue and whatever the user's network is doing. ChatGPT exceeded a
 * minute consistently: the code was issued and simply never redeemed, and the
 * client reported only that the connection could not be set up.
 *
 * That failure is indistinguishable from a wrong secret or a broken endpoint
 * from the outside, and it cost several rounds of debugging elsewhere.
 *
 * RFC 6749 §4.1.2 recommends a maximum of ten minutes. Five keeps a wide margin
 * under that while still being short, and the exposure barely moves: a code is
 * single-use, bound to the client, the redirect URI and a PKCE challenge, so an
 * intercepted one is useless without the verifier.
 */
const CODE_TTL_MS = 5 * 60_000;

/** Codes are high-entropy, so a fast digest is the right hash here. */
function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

/**
 * Issue a code bound to the flow that created it. Everything in `binding` is
 * re-checked at redemption; none of it is trusted from the token request.
 */
export async function issueCode(binding) {
  const code = crypto.randomBytes(32).toString('base64url');

  await AuthorizationCode.create({
    codeHash: hashCode(code),
    clientId: binding.clientId,
    userId: binding.userId,
    redirectUri: binding.redirectUri,
    scopes: binding.scopes,
    codeChallenge: binding.codeChallenge,
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });

  return code;
}

/**
 * Redeem a code exactly once.
 *
 * findOneAndDelete is the whole point: the delete and the read are one
 * operation on the server, so two concurrent redemptions on different Lambda
 * containers cannot both succeed. One receives the document, the other null.
 *
 * Expiry is checked here as well as by the TTL index, because MongoDB's TTL
 * monitor only runs about once a minute and an expired row can outlive its
 * expiresAt by that much.
 */
export async function consumeCode(code) {
  if (!code) return null;

  const entry = await AuthorizationCode.findOneAndDelete({ codeHash: hashCode(code) }).lean();
  if (!entry) return null;
  if (new Date(entry.expiresAt).getTime() <= Date.now()) return null;

  return {
    clientId: entry.clientId,
    userId: entry.userId,
    redirectUri: entry.redirectUri,
    scopes: entry.scopes,
    codeChallenge: entry.codeChallenge,
  };
}

export { CODE_TTL_MS, hashCode };
