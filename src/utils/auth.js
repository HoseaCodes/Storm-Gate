
import jwt from "jsonwebtoken";
import crypto from 'crypto';
import {
	getIssuer,
	getPublicKeyByKid,
	signAccessToken,
} from './signingKeys.js';

const auth = (req, res, next) => {
	try {
		const authHeader = req.header("Authorization");
		if (!authHeader)
			return res.status(400).json({ msg: "Invalid Authentication - no token" });

		// Handle both "Bearer TOKEN" and "TOKEN" formats
		const token = authHeader.startsWith("Bearer ") 
			? authHeader.substring(7) 
			: authHeader;

		// Storm-Gate issues HS256 today and RS256 once JWT_SIGNING_ALG is flipped.
		// Both must verify during the drain window, since 1-day access tokens
		// signed before the flip stay valid after it. Select the key from the
		// token header, then pin `algorithms` to exactly the one that key can
		// validate -- an unpinned verify is what turns a published public key
		// into an HMAC-confusion forgery.
		const header = jwt.decode(token, { complete: true })?.header;
		let verifyKey = process.env.ACCESS_TOKEN_SECRET;
		const verifyOptions = { algorithms: ['HS256'] };

		if (header?.alg === 'RS256') {
			const publicKey = header.kid ? getPublicKeyByKid(header.kid) : null;
			if (!publicKey) {
				return res
					.status(400)
					.json({ msg: "Invalid Authentication - unknown signing key" });
			}
			verifyKey = publicKey;
			verifyOptions.algorithms = ['RS256'];
			const issuer = getIssuer();
			if (issuer) verifyOptions.issuer = issuer;
		}

		jwt.verify(token, verifyKey, verifyOptions, (err, user) => {
      if (err instanceof jwt.TokenExpiredError) {
        return res
        .status(400)
        .json({ msg: "Token Expired Error", err});
      }
      if (err)
				return res
					.status(400)
					.json({ msg: "Invalid Authentication - invalid token"});

			req.user = user;
			next();
		});
	} catch (err) {
		return res.status(500).json({ msg: err.message });
	}
};

// JWT Verification Middleware
let jwksKeys = null;
let jwksExpiry = 0;

// Cache JWKS keys for better performance
const getJWKSKeys = async () => {
  const now = Date.now();
  
  // Refresh keys if cache is expired (cache for 1 hour)
  if (!jwksKeys || now > jwksExpiry) {
    try {
      // Both v1.0 and v2.0 tokens use the same JWKS endpoint
      const response = await fetch(`https://login.microsoftonline.com/${process.env.TENANT_ID}/discovery/v2.0/keys`);
      const jwks = await response.json();
      jwksKeys = jwks.keys;
      jwksExpiry = now + (60 * 60 * 1000); // Cache for 1 hour
    } catch (error) {
      console.error('Failed to fetch JWKS keys:', error);
      throw new Error('Unable to fetch signing keys');
    }
  }
  
  return jwksKeys;
};

// Convert JWK to PEM format
const jwkToPem = (jwk) => {
  const modulus = Buffer.from(jwk.n, 'base64');
  const exponent = Buffer.from(jwk.e, 'base64');
  
  // Create RSA public key
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

export const verifyJWT = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    const token = authHeader.split(' ')[1];
    
    // First, decode the token to inspect its contents
    const decodedToken = jwt.decode(token, { complete: true });
    if (!decodedToken) {
      return res.status(401).json({ error: 'Invalid token format' });
    }
    
    const kid = decodedToken.header.kid;
    if (!kid) {
      return res.status(401).json({ error: 'Token missing key ID' });
    }

    // Get JWKS keys and find the matching key
    const keys = await getJWKSKeys();
    const signingKey = keys.find(key => key.kid === kid);
    
    if (!signingKey) {
      return res.status(401).json({ error: 'Signing key not found' });
    }

    // Convert JWK to PEM format
    const publicKey = jwkToPem(signingKey);

    // Determine the correct audience to validate against
    const possibleAudiences = [
      process.env.CLIENT_ID,
      `api://${process.env.CLIENT_ID}`, // This matches what we see in the token
      process.env.API_IDENTIFIER,
    ].filter(Boolean); // Remove undefined values

    // Azure AD can issue tokens from two different endpoints
    const possibleIssuers = [
      `https://sts.windows.net/${process.env.TENANT_ID}/`, // v1.0 endpoint (what your token uses)
      `https://login.microsoftonline.com/${process.env.TENANT_ID}/v2.0` // v2.0 endpoint
    ];

    const verifiedToken = jwt.verify(token, publicKey, {
      algorithms: ['RS256'],
      audience: possibleAudiences,
      issuer: possibleIssuers
    });

    req.user = verifiedToken;
    next();
  } catch (err) {
    console.error('JWT verification error:', err);
    
    if (err.name === 'JsonWebTokenError' && err.message.includes('audience invalid')) {
      console.error('Audience mismatch. Check your CLIENT_ID or API_IDENTIFIER configuration.');
      console.error('Expected audience(s):', process.env.CLIENT_ID, process.env.API_IDENTIFIER);
    }
    
    res.status(401).json({ error: 'Unauthorized: Token verification failed' });
  }
};


export const createAccessToken = (user) => {
  return signAccessToken(user, { expiresIn: "1d" });
};

// Refresh tokens stay HS256 on REFRESH_TOKEN_SECRET on purpose: only Storm-Gate
// ever verifies them, so there is no third-party verifier to serve and no
// reason to widen this change's blast radius.
export const createRefreshToken = (user) => {
  return jwt.sign(user, process.env.REFRESH_TOKEN_SECRET, { expiresIn: "7d" });
};

export default auth;
