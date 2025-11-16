import dotenv from 'dotenv';
import express from 'express';
import logger from 'morgan';
import cors from 'cors';
import fileUpload from 'express-fileupload';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import uploadRouter from './routes/upload.js';
import userRouter from './routes/user.js';
import authRouter from './routes/auth.js';
import connectDB from './config/db-lambda.js'; // Use Lambda-optimized DB connection
import { imageOp } from './utils/imageOp.js';
import rateLimit from 'express-rate-limit';
import basicAuth from 'express-basic-auth';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerOptions from './utils/swaggerOptions.js';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import userController from './controllers/user.js';
import auth from './utils/auth.js';
import serverless from 'serverless-http';

// Load environment variables
dotenv.config();

// Initialize image operations
imageOp();

// Detect if running in Lambda environment
const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;
const isLocal = !isLambda;

console.log(`Running in ${isLambda ? 'Lambda' : 'Local'} environment`);

const app = express();

// Configure middleware based on environment
if (isLocal) {
  // Use detailed logging for local development
  app.use(logger('dev'));
} else {
  // Use minimal logging for Lambda (CloudWatch handles logging)
  app.use(logger('combined'));
}

app.use(express.json());
app.use(cors());
app.use(cookieParser());
app.use(bodyParser.urlencoded({ extended: true }));

// Configure file upload for Lambda vs Local
if (isLambda) {
  // Lambda: Use /tmp directory with size limits
  app.use(fileUpload({ 
    useTempFiles: true,
    tempFileDir: '/tmp/',
    limits: { 
      fileSize: 50 * 1024 * 1024 // 50MB limit for Lambda
    },
    abortOnLimit: true,
    responseOnLimit: "File size limit exceeded (50MB max for Lambda)"
  }));
} else {
  // Local: Use default configuration
  app.use(fileUpload({ useTempFiles: true }));
}

// Swagger setup
const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Rate limiting configuration based on environment
if (isLocal) {
  // Enable rate limiting for local development
  const limiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 100, // Limit each IP to 100 requests per hour
    message: 'Too many requests from this IP, please try again after an hour',
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use(limiter);
  console.log('Rate limiting enabled for local development');
} else {
  // Lambda: Disable in-memory rate limiting
  // Note: Use API Gateway rate limiting instead for production Lambda deployments
  console.log('Rate limiting disabled for Lambda - use API Gateway rate limiting');
}

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ 
    status: "Server is up and running",
    environment: isLambda ? 'Lambda' : 'Local',
    timestamp: new Date().toISOString()
  });
});

// JWT Verification Middleware with Lambda optimizations
let jwksKeys = null;
let jwksExpiry = 0;

/**
 * Cache JWKS keys for better performance
 * In Lambda, this cache will be maintained across warm invocations
 * For cold starts, we accept the performance hit of fetching keys
 */
const getJWKSKeys = async () => {
  const now = Date.now();
  
  // Refresh keys if cache is expired (cache for 1 hour)
  if (!jwksKeys || now > jwksExpiry) {
    try {
      console.log('Fetching JWKS keys...');
      // Both v1.0 and v2.0 tokens use the same JWKS endpoint
      const response = await fetch(`https://login.microsoftonline.com/${process.env.TENANT_ID}/discovery/v2.0/keys`);
      const jwks = await response.json();
      jwksKeys = jwks.keys;
      jwksExpiry = now + (60 * 60 * 1000); // Cache for 1 hour
      console.log('JWKS keys cached successfully');
    } catch (error) {
      console.error('Failed to fetch JWKS keys:', error);
      
      if (isLambda) {
        // In Lambda, we might want to be more resilient to JWKS failures
        // Consider implementing a fallback or retry mechanism
        console.warn('JWKS fetch failed in Lambda environment - consider implementing retry logic');
      }
      
      throw new Error('Unable to fetch signing keys');
    }
  } else {
    console.log('Using cached JWKS keys');
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

    // Optional: Enable debug logging for Lambda debugging
    if (process.env.DEBUG_JWT === 'true') {
      console.log('Token payload:', {
        aud: decodedToken.payload.aud,
        iss: decodedToken.payload.iss,
        appid: decodedToken.payload.appid,
        azp: decodedToken.payload.azp,
        CLIENT_ID: process.env.CLIENT_ID
      });
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

// Routes configuration
app.use('/auth', authRouter);

// Public endpoints (no JWT required)
app.post('/register', userController.register);
app.post('/login', userController.login);
app.post('/check-status', userController.checkUserStatus);

// Protected endpoints (JWT required)
app.get('/me', auth, userController.getMe);
app.use('/api', verifyJWT, uploadRouter);
app.use('/api/user', verifyJWT, userRouter);

// Lambda-specific initialization
let isInitialized = false;

const initializeApp = async () => {
  if (!isInitialized) {
    try {
      console.log('Initializing application...');
      await connectDB();
      isInitialized = true;
      console.log('Application initialized successfully');
    } catch (error) {
      console.error('Failed to initialize application:', error);
      throw error;
    }
  }
};

// Create serverless handler for Lambda
const handler = serverless(app, {
  // Serverless-http configuration for Lambda
  binary: ['image/*', 'application/pdf', 'application/octet-stream'],
  request: (request, event, context) => {
    // Initialize database connection on each Lambda invocation
    // The connection will be reused if it's already established
    return initializeApp().then(() => request);
  }
});

// Export for Lambda or start server for local development
if (isLambda) {
  // Lambda handler - export is at module level
  console.log('Configuring for Lambda deployment');
} else {
  // Local development server
  console.log('Starting local development server');
  
  const port = process.env.PORT || 8080;
  
  const startServer = async () => {
    try {
      await initializeApp();
      
      app.listen(port, '0.0.0.0', function () {
        console.log(`Express app running on port: ${port}`);
        console.log(`Health check: http://localhost:${port}/health`);
        console.log(`API docs: http://localhost:${port}/api-docs`);
      });
    } catch (error) {
      console.error('Failed to start server:', error);
      process.exit(1);
    }
  };

  startServer();
}

// Export Lambda handler and app
export { handler };
export default app;
