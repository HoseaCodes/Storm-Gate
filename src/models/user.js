import mongoose from "mongoose";

const options = { discriminatorKey: "kind" };

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    username: {
      type: String,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      required: function() {
        // Password is required only for local authentication
        return !this.azureUserId;
      },
    },
    azureUserId: {
      type: String,
      unique: true,
      sparse: true, // Allows multiple null values
      index: true,
    },
    authProvider: {
      type: String,
      enum: ["local", "azure-ad"],
      default: "local",
    },
    avatar: {
      type: Object,
      required: true,
      default:
        "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT0k6I8WItSjK0JTttL3FwACOA6yugI29xvLw&usqp=CAU",
    },
    socialMediaHandles: {
      type: Map,
      of: String,
    },
    role: {
      type: String,
      default: "basic",
      enum: ["basic", "superAdmin", "admin"],
    },
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "DENIED"],
      default: "APPROVED", // Default to APPROVED for backward compatibility
    },
    application: {
      type: String,
      required: true,
    },
    profile: { type: mongoose.Schema.Types.ObjectId, refPath: "role" },
    resetPasswordToken: {
      type: String,
      default: null,
    },
    resetPasswordExpires: {
      type: Date,
      default: null,
    },
    // Email ownership. No default on purpose: accounts created before
    // verification existed have no value and are treated as verified (see
    // utils/emailVerification.js), so shipping this locks nobody out. New
    // sign-ups are created with false.
    emailVerified: { type: Boolean },
    emailVerifiedAt: { type: Date, default: null },
    // HMAC of the current 6-digit code; the code itself is never stored.
    emailVerificationCodeHash: { type: String, default: null },
    emailVerificationExpires: { type: Date, default: null },
    emailVerificationAttempts: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  },
  { strict: false },
  options
);

const User = mongoose.model("User", userSchema);
// Users.createIndexes();

export default User;
