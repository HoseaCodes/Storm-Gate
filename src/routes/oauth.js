// Delegated-access endpoints.
//
// /authorize, /authorize/decision, /revoke and /grants act on behalf of a
// signed-in user and must be mounted behind the user auth middleware.
// /token authenticates the *client*, not the user, so it must NOT be.
import express from 'express';
import oauthController from '../controllers/oauth.js';

const router = express.Router();

// Client-authenticated. No user session involved.
router.post('/token', oauthController.token);

export const userRouter = express.Router();
userRouter.get('/authorize', oauthController.authorize);
userRouter.post('/authorize/decision', oauthController.decision);
userRouter.post('/revoke', oauthController.revoke);
userRouter.get('/grants', oauthController.listGrants);

export default router;
