// Delegated-access endpoints.
//
// /authorize, /authorize/decision, /revoke and /grants act on behalf of a
// signed-in user and must be mounted behind the user auth middleware.
// /token authenticates the *client*, not the user, so it must NOT be.
import express from 'express';
import oauthController from '../controllers/oauth.js';
import clientRegistrationController from '../controllers/clientRegistration.js';

const router = express.Router();

// Client-authenticated. No user session involved.
router.post('/token', oauthController.token);

/*
 * RFC 7591. Unauthenticated by design, and mounted here rather than behind the
 * user router because a client registers *before* any user is involved.
 *
 * What it can create is a client record that may ask an athlete for consent —
 * not access to anything. The athlete still approves, and the scopes it may
 * request are fixed by the server.
 */
router.post('/register', clientRegistrationController.register);

export const userRouter = express.Router();
userRouter.get('/authorize', oauthController.authorize);
userRouter.post('/authorize/decision', oauthController.decision);
userRouter.post('/revoke', oauthController.revoke);
userRouter.get('/grants', oauthController.listGrants);

export default router;
