import mongoose from "mongoose";

const URI = process.env.MONGODB_URL || "mongodb://localhost:27017/stormGate";
const connectDB = async () => await mongoose
  .connect(URI)
  .then(() => console.log(`Connected to MongoDB: ${URI}`))
  .catch((err) => console.log(`MongoDB error: ${err.message}`));  


export default connectDB;
