import dotenv from 'dotenv';
import express from 'express';
import logger from 'morgan';
import cors from 'cors';
import fileUpload from 'express-fileupload';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import uploadRouter from './routes/upload.js';
import userRouter from './routes/user.js';
import connectDB from './config/db.js';
import { imageOp } from './utils/imageOp.js';
import rateLimit from 'express-rate-limit';
import basicAuth from 'express-basic-auth';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerOptions from './utils/swaggerOptions.js';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

dotenv.config();
imageOp();

const app = express();
app.use(logger('dev'));
app.use(express.json());
app.use(cors());
app.use(cookieParser());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(fileUpload({ useTempFiles: true }));

// Swagger setup
const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// app.use(basicAuth({ users: { admin: "supersecret" } }));

const limiter = rateLimit({
	// windowMs: 15 * 60 * 1000, // 15 minutes
	// max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  windowMs: 60 * 60 * 1000, // 1 hour
	max: 100, // Limit each IP to 100 requests per `window` (here, per 1 hour)
  message:
  'Too many accounts created from this IP, please try again after an hour',
	standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
	legacyHeaders: false, // Disable the `X-RateLimit-*` headers
})

app.use(limiter);

app.get("/health", (req, res) => {
  res.status(200).json({ status: "Server is up and running" });
});

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

const verifyJWT = async (req, res, next) => {
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

    // Optional: Enable debug logging if needed
    // console.log('Token payload:', {
    //   aud: decodedToken.payload.aud,
    //   iss: decodedToken.payload.iss,
    //   appid: decodedToken.payload.appid,
    //   azp: decodedToken.payload.azp,
    //   CLIENT_ID: process.env.CLIENT_ID
    // });
    
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

app.use('/api', verifyJWT, uploadRouter);
app.use('/api/user', verifyJWT, userRouter);

const port = process.env.PORT || 3001;
const startServer = async () => {
  await connectDB();
  app.listen(port, function () {
    console.log(`Express app running on port: ${port}`);
  });
};

startServer();