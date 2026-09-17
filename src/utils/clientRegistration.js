// Validation for service-client registration.
//
// Extracted from the registration script so it can be tested without a
// database, and so the rules live next to the code that depends on them:
// redirect URIs are matched by exact string equality at authorize time, which
// means a malformed one here produces a client that can never complete a flow.
export function validateRedirectUri(uri) {
  let url;
  try {
    url = new URL(uri);
  } catch {
    return `not a valid absolute URL: ${uri}`;
  }
  // http is permitted only for loopback, where there is no network to intercept.
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    return `must be https (or localhost for development): ${uri}`;
  }
  // Fragments are never sent to the server, so a redirect URI carrying one can
  // never match what the authorization endpoint receives.
  if (url.hash) return `must not contain a fragment: ${uri}`;
  if (url.username || url.password) return `must not contain credentials: ${uri}`;
  return null;
}

/**
 * Validate a registration request. Returns an array of problems; empty means
 * valid. Runs before any database connection so a bad argument fails fast.
 */
export function validateRegistration({ clientId, redirectUris = [], audience, scopes = [], isNew }) {
  const errors = [];

  if (!clientId || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(clientId)) {
    errors.push('--id must be 2-64 characters of lowercase letters, digits and hyphens');
  }

  if (isNew && redirectUris.length === 0) {
    errors.push('At least one --redirect is required when registering a new client');
  }
  for (const problem of redirectUris.map(validateRedirectUri).filter(Boolean)) {
    errors.push(`Invalid redirect URI: ${problem}`);
  }

  if (isNew && !audience) {
    errors.push('--audience is required: it becomes the `aud` claim, and the API verifying these tokens must match it');
  }

  if (isNew && scopes.length === 0) {
    errors.push('At least one --scope is required: a client with no scopes can request nothing');
  }

  return errors;
}
