// Guards the gap that made the delegated-access work undeployable: the routes
// existed only on the Express entrypoint used for local development.
//
// service.yaml states production runs on AWS Lambda behind API Gateway, with
// the Express process for local development only. Anything that must exist in
// production has to be mounted in BOTH entrypoints, and nothing in the code
// makes that obvious -- adminRouter and extAuthRouter are mounted in only one.
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

const server = read('src/server.js');
const lambda = read('src/lambda-app.js');

describe('entrypoint parity for delegated access', () => {
  it('mounts the client-authenticated /oauth router in both entrypoints', () => {
    expect(server).toContain("app.use('/oauth', oauthRouter)");
    expect(lambda).toContain("app.use('/oauth', oauthRouter)");
  });

  it('mounts the user-authenticated /oauth routes behind auth in both', () => {
    expect(server).toContain("app.use('/oauth', auth, oauthUserRouter)");
    expect(lambda).toContain("app.use('/oauth', auth, oauthUserRouter)");
  });

  // /oauth/token authenticates the client with its own credentials. Putting it
  // behind user auth would make the token endpoint unreachable for the service
  // it exists to serve.
  it('does not place the token endpoint behind user auth', () => {
    for (const src of [server, lambda]) {
      const tokenMount = src.indexOf("app.use('/oauth', oauthRouter)");
      const authMount = src.indexOf("app.use('/oauth', auth, oauthUserRouter)");
      expect(tokenMount).toBeGreaterThan(-1);
      expect(authMount).toBeGreaterThan(-1);
      // Express matches in order, so the unauthenticated router must come first.
      expect(tokenMount).toBeLessThan(authMount);
    }
  });

  it('verifies the TTL indexes during Lambda initialisation', () => {
    expect(lambda).toContain('ensureOAuthIndexes');
  });

  // OIDC was Express-only for as long as its login state lived in a
  // process-local Map. That state now lives in MongoDB, so it is mounted in
  // both -- and this assertion is what stops it regressing to one.
  it('mounts OIDC in both entrypoints', () => {
    expect(server).toContain('extAuthRouter');
    expect(lambda).toContain('extAuthRouter');
  });
});

describe('delegated-access storage is not process-local', () => {
  it('uses MongoDB-backed stores rather than an in-memory map', () => {
    const store = read('src/utils/authCodeStore.js');
    expect(store).toContain('AuthorizationCode');
    expect(store).toContain('findOneAndDelete');
    expect(store).not.toContain('new Map()');
  });

  it('keeps refresh tokens out of node-cache', () => {
    const controller = read('src/controllers/oauth.js');
    expect(controller).not.toContain("from '../utils/cache.js'");
    expect(controller).toContain('serviceRefreshStore.js');
  });

  // The two things that kept OIDC off Lambda.
  it('keeps OIDC login state out of process memory', () => {
    const controller = read('src/controllers/ext-auth.js');
    expect(controller).not.toContain('new Map()');
    expect(controller).not.toContain("from '../utils/cache.js'");
    expect(controller).toContain('oidcSessionStore.js');
  });

  it('verifies TTL indexes for every short-lived-credential collection', () => {
    const ensure = read('src/utils/ensureOAuthIndexes.js');
    for (const model of ['AuthorizationCode', 'ServiceRefreshToken', 'OidcAuthSession', 'OidcRefreshToken']) {
      expect(ensure).toContain(model);
    }
  });
});
