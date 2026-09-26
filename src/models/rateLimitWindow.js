// One fixed window of one rate-limit key.
//
// Production runs on Lambda, where an in-memory limiter counts per container
// and resets on every cold start, so it was switched off there and nothing
// replaced it. Counting in MongoDB holds across containers.
//
// `_id` carries the window start, so a new window is a new document rather
// than a reset of an existing one: no read-modify-write, and no race over who
// decides the window has rolled over.
import mongoose from "mongoose";

const rateLimitWindowSchema = new mongoose.Schema(
  {
    // `<key>:<windowStart>`
    _id: { type: String, required: true },
    count: { type: Number, required: true, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false }
);

// Swept by Mongo's TTL monitor (about once a minute). Correctness comes from
// the window being part of the id, not from the sweep.
rateLimitWindowSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const RateLimitWindow = mongoose.model("RateLimitWindow", rateLimitWindowSchema);

export default RateLimitWindow;
