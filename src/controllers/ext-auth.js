import * as oauth from 'openid-client';
import jwt from 'jsonwebtoken';
import User from "../models/user.js";
import BlogUser from "../models/blogUser.js";
import Logger from "../utils/logger-lambda.js";
import { signAccessToken } from "../utils/signingKeys.js";
import { isAllowedReturnUrl } from "../utils/redirectAllowlist.js";
import {
  createAuthSession,
  consumeAuthSession,
  discardAuthSession,
  storeRefreshToken,
  isCurrentRefreshToken,
  invalidateRefreshToken,
} from "../utils/oidcSessionStore.js";

const logger = new Logger("auth");

// OIDC Client configuration
let azureConfiguration = null;

const initializeOIDCConfig = async () => {
  if (azureConfiguration) return azureConfiguration;
  
  try {
    const issuerUrl = `https://login.microsoftonline.com/${process.env.TENANT_ID}/v2.0`;
    azureConfiguration = await oauth.discovery(new URL(issuerUrl), process.env.CLIENT_ID, process.env.CLIENT_SECRET);
    
    logger.info('OIDC Configuration initialized successfully');
    return azureConfiguration;
  } catch (error) {
    logger.error('Failed to initialize OIDC configuration:', error);
    throw new Error('OIDC initialization failed');
  }
};

// Login state lives in MongoDB (see src/utils/oidcSessionStore.js). It was a
// process-local Map, which is why these routes could not be mounted on the
// Lambda entrypoint: /login and /callback are separate requests and Lambda
// makes no promise they share a container.

/**
 * Initiate OIDC Authorization Code Flow
 * GET /auth/login
 */
async function initiateLogin(req, res) {
  try {
    // Validate return_url first: before the IdP round trip, before any state is
    // allocated, and before the victim of a crafted link authenticates at all.
    // An attacker's link should fail flat, not after a real login.
    const requestedReturnUrl = req.query.return_url;
    if (requestedReturnUrl && !isAllowedReturnUrl(requestedReturnUrl)) {
      logger.error('Rejected login with a return_url outside the allowlist');
      return res.status(400).json({ error: 'Invalid return_url' });
    }

    const config = await initializeOIDCConfig();
    
    // Generate state and code verifier for PKCE
    const state = oauth.randomState();
    const codeVerifier = oauth.randomPKCECodeVerifier();
    const codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier);
    
    await createAuthSession(state, {
      codeVerifier,
      application: req.query.application || 'default',
      returnUrl: requestedReturnUrl || null,
    });
    
    // Build authorization URL
    const authUrl = oauth.buildAuthorizationUrl(config, {
      client_id: process.env.CLIENT_ID,
      scope: 'openid profile email offline_access',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      response_type: 'code',
      redirect_uri: process.env.REDIRECT_URI || 'http://localhost:3001/auth/callback'
    });
    
    logger.info(`Initiating OIDC login for application: ${req.query.application}`);
    
    // Redirect user to Azure AD
    res.redirect(authUrl.href);
  } catch (error) {
    logger.error('Login initiation failed:', error);
    res.status(500).json({ 
      error: 'Authentication service unavailable',
      message: error.message 
    });
  }
}

/**
 * Handle OIDC Authorization Code Callback
 * GET /auth/callback
 */
async function handleCallback(req, res) {
  try {
    const config = await initializeOIDCConfig();
    const { code, state, error, error_description } = req.query;
    
    // Handle OAuth errors
    if (error) {
      logger.error(`OAuth error: ${error} - ${error_description}`);
      return res.status(400).json({ 
        error: 'Authentication failed',
        details: error_description 
      });
    }
    
    // Reading the session destroys it, so `state` is single-use. The previous
    // implementation deleted it only after a successful exchange, leaving a
    // window in which the same state could be replayed -- the attack `state`
    // exists to prevent. Expired rows are reaped by a TTL index rather than by
    // sweeping the whole collection on every callback.
    const sessionData = await consumeAuthSession(state);
    if (!sessionData) {
      logger.error('Invalid, expired or already-used state parameter');
      return res.status(400).json({ error: 'Invalid authentication request' });
    }
    
    // Exchange authorization code for tokens
    const tokens = await oauth.authorizationCodeGrant(config, new URL(req.originalUrl, `${req.protocol}://${req.get('host')}`), {
      pkce_code_verifier: sessionData.codeVerifier
    });
    
    // Decode the ID token to get user claims
    const claims = tokens.id_token ? JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64').toString()) : null;
    
    if (!claims) {
      return res.status(400).json({ error: 'No user claims found in token' });
    }
    
    logger.info(`Successful authentication for user: ${claims.preferred_username || claims.email}`);
    
    // Find or create user based on Azure AD claims
    let user = await findOrCreateUser(claims, sessionData.application);
    
    // Create internal JWT tokens for your application
    const accessToken = createInternalAccessToken(user);
    const refreshToken = createInternalRefreshToken(user);
    
    // Store refresh token securely
    await storeRefreshToken(user._id, refreshToken);
    
    // Set secure cookies
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    };
    
    res.cookie('refreshtoken', refreshToken, {
      ...cookieOptions,
      path: '/auth/refresh'
    });
    
    res.cookie('accesstoken', accessToken, {
      ...cookieOptions,
      maxAge: 15 * 60 * 1000, // 15 minutes
      path: '/'
    });
    
    // Redirect to the application without the token.
    //
    // The access token used to be appended as ?token=..., which leaked it into
    // browser history, Referer headers on any outbound link, proxy logs and
    // analytics -- and, before the allowlist above, to any host an attacker
    // named. The accesstoken cookie set immediately above already carries it to
    // the same origin with httpOnly/secure/sameSite, so the query parameter
    // bought nothing that the cookie does not.
    //
    // Re-checked here rather than trusting the stored value: defence in depth
    // against anything that could alter the stored session between the two points.
    if (sessionData.returnUrl && isAllowedReturnUrl(sessionData.returnUrl)) {
      return res.redirect(sessionData.returnUrl);
    }
    if (sessionData.returnUrl) {
      logger.error('Stored return_url failed re-validation; falling back to JSON');
    }
    
    res.json({
      status: 'success',
      message: 'Authentication successful',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        application: user.application,
        role: user.role
      },
      tokens: {
        accessToken,
        expiresIn: 900 // 15 minutes
      }
    });
    
  } catch (error) {
    logger.error('Callback handling failed:', error);
    await discardAuthSession(req.query.state); // Clean up on error
    
    res.status(500).json({ 
      error: 'Authentication processing failed',
      message: error.message 
    });
  }
}

/**
 * Refresh Access Token
 * POST /auth/refresh
 */
async function refreshAccessToken(req, res) {
  try {
    let refreshToken = req.cookies.refreshtoken || req.body.refreshToken;
    
    if (!refreshToken) {
      return res.status(401).json({ error: 'Refresh token required' });
    }
    
    // Remove JWT prefix if present
    refreshToken = refreshToken.replace(/^JWT\s/, '');
    
    // Verify refresh token
    const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
    
    // Compared as a digest, so the stored value never reaches this scope and
    // cannot leak through a log line or an error message.
    if (!(await isCurrentRefreshToken(decoded.id, refreshToken))) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }
    
    // Get user
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    
    // Create new access token
    const newAccessToken = createInternalAccessToken(user);
    
    res.json({
      accessToken: newAccessToken,
      expiresIn: 900 // 15 minutes
    });
    
  } catch (error) {
    logger.error('Token refresh failed:', error);
    res.status(401).json({ error: 'Token refresh failed' });
  }
}

/**
 * Logout user and clean up sessions
 * POST /auth/logout
 */
async function logout(req, res) {
  try {
    const refreshToken = req.cookies.refreshtoken;
    
    if (refreshToken) {
      // Invalidate refresh token
      const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
      await invalidateRefreshToken(decoded.id);
    }
    
    // Clear cookies
    res.clearCookie('refreshtoken', { path: '/auth/refresh' });
    res.clearCookie('accesstoken', { path: '/' });
    
    logger.info('User logged out successfully');
    res.json({ 
      status: 'success',
      message: 'Logged out successfully' 
    });
    
  } catch (error) {
    logger.error('Logout failed:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
}

/**
 * Get current user info
 * GET /auth/me
 */
async function getCurrentUser(req, res) {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        application: user.application,
        role: user.role,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    logger.error('Get current user failed:', error);
    res.status(500).json({ error: 'Failed to get user info' });
  }
}

// Helper Functions

async function findOrCreateUser(claims, application = 'default') {
  const { preferred_username, name, email, sub: azureUserId } = claims;
  
  // Try to find existing user by email or Azure user ID
  let user = await User.findOne({
    $or: [
      { email: email || preferred_username },
      { azureUserId }
    ]
  });
  
  if (user) {
    // Update Azure user ID if not set
    if (!user.azureUserId) {
      user.azureUserId = azureUserId;
      await user.save();
    }
    return user;
  }
  
  // Create new user based on application type
  const userData = {
    name: name || preferred_username,
    email: email || preferred_username,
    azureUserId,
    application,
    role: 'basic', // Default role
    authProvider: 'azure-ad'
  };
  
  switch (application) {
    case 'blog':
      user = new BlogUser({
        ...userData,
        aboutMe: 'About me'
      });
      break;
    default:
      user = new User(userData);
      break;
  }
  
  await user.save();
  logger.info(`Created new user: ${user.email} for application: ${application}`);
  
  return user;
}

function createInternalAccessToken(user) {
  return signAccessToken(
    {
      id: user._id,
      email: user.email,
      role: user.role,
      application: user.application
    },
    { expiresIn: '15m' }
  );
}

function createInternalRefreshToken(user) {
  return jwt.sign(
    { id: user._id },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: '7d' }
  );
}

const authController = {
  initiateLogin,
  handleCallback,
  refreshAccessToken,
  logout,
  getCurrentUser
};

export default authController;
