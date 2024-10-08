
import dotenv from 'dotenv';
import express from 'express';
import logger from 'morgan';
import cors from 'cors';
import fileUpload from 'express-fileupload';
import bodyParser from "body-parser";
import cookieParser from 'cookie-parser'
import uploadRouter from './routes/upload.js';
import userRouter from './routes/user.js';
import connectDB from './config/db.js';
import {imageOp} from './utils/imageOp.js';
import rateLimit from 'express-rate-limit';
import basicAuth from 'express-basic-auth';

dotenv.config();
imageOp();

const app = express();
app.use(logger('dev'));
app.use(express.json());
app.use(cors());
app.use(cookieParser());
app.use(bodyParser.urlencoded({
    extended: true
}));
app.use(fileUpload({
    useTempFiles: true
}));


app.use(
  basicAuth({
    users: { admin: "supersecret" },
  })
);

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

// Apply the rate limiting middleware to all requests
app.use(limiter);

app.get("/health", (req, res) => {
  res.status(200).json({ status: "Server is up and running" });
});

app.use('/api', uploadRouter);
app.use('/api/user', userRouter);

// Configure to use port 3001 instead of 3000 during
// development to avoid collision with React's dev server
const port = process.env.PORT || 3001;
const startServer = async () => {
  await connectDB();
  app.listen(port, function () {
      console.log(`Express app running on port: ${port}`)
  });
};

startServer();
