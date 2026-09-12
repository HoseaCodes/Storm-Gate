import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import User from '../models/user.js';
import Logger from './logger-lambda.js';
import { getIssuer, getPublicKeyByKid } from './signingKeys.js';

const logger = new Logger('auth-middleware');

/**
 * Enhanced JWT verification middleware that supports both:
 * 1. Internal JWT tokens (created by our auth system)
 * 2. Azure AD JWT tokens (from direct Azure authentication)
 */
const enhancedVerifyJWT = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    const token = authHeader.split(' ')[1];

    // First try to verify as an internally-issued token. Storm-Gate signs these
    // HS256 by default and RS256 once JWT_SIGNING_ALG is flipped, so both have
    // to verify here -- 1-day tokens signed before the flip stay valid after it.
    //
    // A `kid` that resolves against our OWN published key set is what separates
    // our RS256 tokens from Azure AD's: Azure's kids never resolve here, so
    // those fall through to the Azure branch below exactly as before.
    //
    // `algorithms` is pinned to the one algorithm the selected key can validate.
    // Leaving it open is what lets an attacker HMAC-sign a token using our
    // published RSA public key as the shared secret and have it accepted.
    const header = jwt.decode(token, { complete: true })?.header;
    const ourKey =
      header?.alg === 'RS256' && header.kid ? getPublicKeyByKid(header.kid) : null;

    try {
      let decoded;
      if (ourKey) {
        const verifyOptions = { algorithms: ['RS256'] };
        const issuer = getIssuer();
        if (issuer) verifyOptions.issuer = issuer;
        decoded = jwt.verify(token, ourKey, verifyOptions);
      } else {
        decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, {
          algorithms: ['HS256'],
        });
      }

      // For internal tokens, we trust the payload directly
      if (decoded.id) {
        req.user = decoded;
        return next();
      }
    } catch (internalError) {
      // If internal token verification fails, try Azure AD token verification
      logger.info('Internal token verification failed, trying Azure AD token');
    }

    // Fall back to Azure AD token verification (original server.js logic)
    const decodedToken = jwt.decode(token, { complete: true });
    if (!decodedToken) {
      return res.status(401).json({ error: 'Invalid token format' });
    }

    const kid = decodedToken.header.kid;
    if (!kid) {
      return res.status(401).json({ error: 'Token missing key ID' });
    }

    // Get JWKS keys and find the matching key (reuse existing logic)
    const keys = await getJWKSKeys();
    const signingKey = keys.find(key => key.kid === kid);
    
    if (!signingKey) {
      return res.status(401).json({ error: 'Signing key not found' });
    }

    // Convert JWK to PEM format (reuse existing logic)
    const publicKey = jwkToPem(signingKey);

    // Determine the correct audience to validate against
    const possibleAudiences = [
      process.env.CLIENT_ID,
      `api://${process.env.CLIENT_ID}`,
      process.env.API_IDENTIFIER,
    ].filter(Boolean);

    // Azure AD can issue tokens from two different endpoints
    const possibleIssuers = [
      `https://sts.windows.net/${process.env.TENANT_ID}/`,
      `https://login.microsoftonline.com/${process.env.TENANT_ID}/v2.0`
    ];

    const verifiedToken = jwt.verify(token, publicKey, {
      algorithms: ['RS256'],
      audience: possibleAudiences,
      issuer: possibleIssuers
    });

    // For Azure tokens, find or create the user in our database
    const user = await findUserByAzureId(verifiedToken.sub || verifiedToken.oid);
    if (!user) {
      return res.status(401).json({ error: 'User not found in system' });
    }

    req.user = {
      id: user._id,
      email: user.email,
      role: user.role,
      application: user.application,
      azureUserId: verifiedToken.sub || verifiedToken.oid
    };

    next();
  } catch (err) {
    logger.error('JWT verification error:', err);
    
    if (err.name === 'JsonWebTokenError' && err.message.includes('audience invalid')) {
      logger.error('Audience mismatch. Check your CLIENT_ID or API_IDENTIFIER configuration.');
    }
    
    res.status(401).json({ error: 'Unauthorized: Token verification failed' });
  }
};

// Helper functions (reuse from server.js)
let jwksKeys = null;
let jwksExpiry = 0;

const getJWKSKeys = async () => {
  const now = Date.now();
  
  if (!jwksKeys || now > jwksExpiry) {
    try {
      const response = await fetch(`https://login.microsoftonline.com/${process.env.TENANT_ID}/discovery/v2.0/keys`);
      const jwks = await response.json();
      jwksKeys = jwks.keys;
      jwksExpiry = now + (60 * 60 * 1000);
    } catch (error) {
      logger.error('Failed to fetch JWKS keys:', error);
      throw new Error('Unable to fetch signing keys');
    }
  }
  
  return jwksKeys;
};

const jwkToPem = (jwk) => {
  const key = crypto.createPublicKey({
    key: {
      kty: 'RSA',
      n: jwk.n,
      e: jwk.e
    },
    format: 'jwk'
  });
  
  return key.export({ type: 'spki', format: 'pem' });
};

const findUserByAzureId = async (azureUserId) => {
  return await User.findOne({ azureUserId });
};

export default enhancedVerifyJWT;
