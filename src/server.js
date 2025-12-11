import dotenv from 'dotenv';
import express from 'express';
import logger from 'morgan';
import cors from 'cors';
import fileUpload from 'express-fileupload';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import uploadRouter from './routes/upload.js';
import userRouter from './routes/user.js';
import extAuthRouter from './routes/ext-auth.js';
import authRouter from './routes/auth.js';
import adminRouter from './routes/admin.js';
import connectDB from './config/db.js';
import { imageOp } from './utils/imageOp.js';
import rateLimit from 'express-rate-limit';
import basicAuth from 'express-basic-auth';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerOptions from './utils/swaggerOptions.js';
import userController from './controllers/user.js';
import auth from './utils/auth.js';
import isAdmin from './utils/authAdmin.js';
import { verifyJWT } from './utils/auth.js';

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

// Public registration endpoint (no JWT required)
app.get("/health", (req, res) => {
  res.status(200).json({ status: "Server is up and running" });
});
// app.post('/api/auth/logout', userController.logout);
// app.get('/api/auth/refresh_token', userController.refreshToken);
// app.post('/register', userController.register);
// app.post('/login', userController.login);
app.post('/check-status', userController.checkUserStatus);
// app.post('/reset-password/:token', userController.resetPassword);
// app.post('/forgot-password', userController.requestPasswordReset);
// app.post('/verify-reset-token/:token', userController.verifyResetToken);
// Protected me endpoint (JWT required) - using local auth
app.get('/me', auth, userController.getMe);
app.use('/api', verifyJWT, uploadRouter);
// app.use('/api/auth', authRouter)
app.use('/', authRouter)
app.use('/api/auth/admin', auth, isAdmin, adminRouter);
app.use('/api/auth/oidc', extAuthRouter);
app.use('/api/user', verifyJWT, userRouter);

const port = process.env.PORT || 8080;
const startServer = async () => {
  try {
    // Wait for database connection before starting server
    await connectDB();
    console.log('Database connection established');
    
    app.listen(port, '0.0.0.0', function () {
      console.log(`✓ Express app running on port: ${port}`);
      console.log(`Email Integrator Base URL: ${process.env.EMAIL_INTEGRATOR_BASE_URL}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err.message);
    process.exit(1); // Exit if DB connection fails
  }
};

startServer();