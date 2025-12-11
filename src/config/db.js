import mongoose from "mongoose";

const URI = process.env.MONGODB_URL || "mongodb://localhost:27017/stormGate";

// Configure mongoose settings
mongoose.set('strictQuery', false);

const connectDB = async () => {
  try {
    const options = {
      serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
      socketTimeoutMS: 45000, // Close sockets after 45s of inactivity
      maxPoolSize: 10, // Maintain up to 10 socket connections
      minPoolSize: 2, // Maintain at least 2 socket connections
      connectTimeoutMS: 10000, // Give up initial connection after 10s
      heartbeatFrequencyMS: 2000, // Check connection health every 2s
    };

    await mongoose.connect(URI, options);
    console.log(`✓ Connected to MongoDB: ${URI}`);

    // Handle connection events
    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('MongoDB disconnected. Attempting to reconnect...');
    });

    mongoose.connection.on('reconnected', () => {
      console.log('MongoDB reconnected');
    });

  } catch (err) {
    console.error(`MongoDB connection error: ${err.message}`);
    console.error('Stack:', err.stack);
    throw err; // Rethrow to prevent server from starting without DB
  }
};

export default connectDB;
