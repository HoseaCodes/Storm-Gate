import mongoose from "mongoose";

const URI = process.env.MONGODB_URL || "mongodb://localhost:27017/stormGate";

// Global variable to cache the database connection across Lambda invocations
let cachedConnection = null;

/**
 * Lambda-optimized database connection with connection pooling and reuse
 * This prevents creating new connections on every Lambda invocation
 */
const connectDB = async () => {
  // If we have a cached connection and it's ready, reuse it
  if (cachedConnection && mongoose.connection.readyState === 1) {
    console.log('Reusing existing MongoDB connection');
    return cachedConnection;
  }

  try {
    // Configure mongoose for Lambda environment
    mongoose.set('bufferCommands', false); // Disable mongoose buffering for Lambda

    // Connection options optimized for Lambda
    const options = {
      // Connection pool settings for Lambda
      maxPoolSize: 5, // Reduced pool size for Lambda (default is 100)
      minPoolSize: 1, // Minimum connections to maintain
      maxIdleTimeMS: 30000, // Close connections after 30 seconds of inactivity
      serverSelectionTimeoutMS: 5000, // How long to try selecting a server
      socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
      
      // Heartbeat settings
      heartbeatFrequencyMS: 10000, // Heartbeat every 10 seconds
      
      // Retry settings
      retryWrites: true,
      retryReads: true,
      
      // Buffer settings for Lambda
      bufferCommands: false,
    };

    console.log('Creating new MongoDB connection for Lambda...');
    
    // Create new connection
    cachedConnection = await mongoose.connect(URI, options);
    
    console.log(`Connected to MongoDB: ${URI}`);
    
    // Handle connection events
    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err);
      cachedConnection = null; // Reset cache on error
    });

    mongoose.connection.on('disconnected', () => {
      console.log('MongoDB disconnected');
      cachedConnection = null; // Reset cache on disconnect
    });

    // For Lambda, we don't want to close connections automatically
    // Let Lambda container lifecycle handle connection cleanup
    
    return cachedConnection;
    
  } catch (error) {
    console.error('MongoDB connection error:', error.message);
    cachedConnection = null; // Reset cache on error
    throw error;
  }
};

/**
 * Gracefully close database connection
 * This is mainly for local development and testing
 */
const closeDB = async () => {
  if (cachedConnection) {
    await mongoose.connection.close();
    cachedConnection = null;
    console.log('MongoDB connection closed');
  }
};

/**
 * Check if database is connected
 */
const isConnected = () => {
  return mongoose.connection.readyState === 1;
};

export default connectDB;
export { closeDB, isConnected };
