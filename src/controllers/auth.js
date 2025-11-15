import * as oauth from 'openid-client';
import jwt from 'jsonwebtoken';
import User from "../models/user.js";
import BlogUser from "../models/blogUser.js";
import Logger from "../utils/logger.js";
import { cache } from "../utils/cache.js";

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

// Store state and nonce temporarily (in production, use Redis or database)
const authSessions = new Map();

/**
 * Initiate OIDC Authorization Code Flow
 * GET /auth/login
 */
async function initiateLogin(req, res) {
  try {
    const config = await initializeOIDCConfig();
    
    // Generate state and code verifier for PKCE
    const state = oauth.randomState();
    const codeVerifier = oauth.randomPKCECodeVerifier();
    const codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier);
    
    // Store session data (in production, use secure session storage)
    authSessions.set(state, {
      codeVerifier,
      application: req.query.application || 'default',
      returnUrl: req.query.return_url,
      timestamp: Date.now()
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
    
    // Validate state parameter
    const sessionData = authSessions.get(state);
    if (!sessionData) {
      logger.error('Invalid or expired state parameter');
      return res.status(400).json({ error: 'Invalid authentication request' });
    }
    
    // Clean up expired sessions (older than 10 minutes)
    const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
    for (const [key, value] of authSessions.entries()) {
      if (value.timestamp < tenMinutesAgo) {
        authSessions.delete(key);
      }
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
    
    // Clean up session
    authSessions.delete(state);
    
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
    
    // Redirect to application or return tokens
    if (sessionData.returnUrl) {
      return res.redirect(`${sessionData.returnUrl}?token=${accessToken}`);
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
    authSessions.delete(req.query.state); // Clean up on error
    
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
    
    // Check if refresh token is still valid in storage
    const storedToken = await getStoredRefreshToken(decoded.id);
    if (storedToken !== refreshToken) {
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
  return jwt.sign(
    { 
      id: user._id,
      email: user.email,
      role: user.role,
      application: user.application
    },
    process.env.ACCESS_TOKEN_SECRET,
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

async function storeRefreshToken(userId, token) {
  // Store in cache with 7-day TTL
  cache.set(`refresh_token_${userId}`, token, 7 * 24 * 60 * 60);
}

async function getStoredRefreshToken(userId) {
  return cache.get(`refresh_token_${userId}`);
}

async function invalidateRefreshToken(userId) {
  cache.del(`refresh_token_${userId}`);
}

const authController = {
  initiateLogin,
  handleCallback,
  refreshAccessToken,
  logout,
  getCurrentUser
};

export default authController;
