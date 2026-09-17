// Make sure the short-lived-credential TTL indexes actually exist.
//
// Four collections depend on a TTL index to reap expired rows: the two backing
// delegated access, and the two backing OIDC login. Their
// absence is not a correctness bug -- every read compares `expiresAt` itself,
// precisely so that expiry never depends on the TTL monitor -- but it is an
// unbounded-growth bug, and a silent one.
//
// Mongoose's autoIndex would normally build these, but relying on it here is a
// poor fit for Lambda: index creation is attempted on every cold start, and a
// failure surfaces as an unhandled event on the connection rather than
// anywhere an operator will look. Doing it explicitly makes the outcome
// observable in CloudWatch.
//
// createIndexes() is idempotent and cheap once the indexes exist, so calling it
// on each cold start costs one command against an already-open connection.
import AuthorizationCode from '../models/authorizationCode.js';
import ServiceRefreshToken from '../models/serviceRefreshToken.js';
import OidcAuthSession from '../models/oidcAuthSession.js';
import OidcRefreshToken from '../models/oidcRefreshToken.js';

export async function ensureOAuthIndexes({ log = console } = {}) {
  const results = [];

  for (const model of [AuthorizationCode, ServiceRefreshToken, OidcAuthSession, OidcRefreshToken]) {
    try {
      await model.createIndexes();
      results.push({ collection: model.collection.name, ok: true });
    } catch (error) {
      // Deliberately not rethrown. A missing TTL index degrades cleanup, but
      // failing startup over it would take down authentication entirely --
      // a far worse outcome than a collection that grows until someone
      // notices this log line.
      log.error?.(
        `[oauth] TTL index creation failed for ${model.collection.name}: ${error.message}`,
      );
      results.push({ collection: model.collection.name, ok: false, error: error.message });
    }
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) {
    log.log?.(`[oauth] TTL indexes verified for ${results.map((r) => r.collection).join(', ')}`);
  }
  return results;
}

export default ensureOAuthIndexes;
