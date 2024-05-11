import mongoose from "mongoose";

const URI = process.env.MONGODB_URL || "mongodb://localhost:27017/stormGate";
const connectDB = () => mongoose
  .connect(URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("Connected to MongoDB"));


export default connectDB;
