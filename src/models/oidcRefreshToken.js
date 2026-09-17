// Refresh tokens issued through the OIDC login path.
//
// One row per user, matching the behaviour this replaces: a fresh login
// overwrites the previous token rather than accumulating sessions.
//
// Stored as a digest. The previous implementation kept the full JWT in
// node-cache and compared it by string equality, so anything that could read
// the cache held every live session.
import mongoose from "mongoose";

const oidcRefreshTokenSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
    },

    tokenHash: {
      type: String,
      required: true,
    },

    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

oidcRefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const OidcRefreshToken = mongoose.model("OidcRefreshToken", oidcRefreshTokenSchema);

export default OidcRefreshToken;
