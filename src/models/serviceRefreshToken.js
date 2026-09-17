// Refresh tokens for delegated service grants.
//
// Kept in MongoDB rather than node-cache for the same reason as
// authorizationCode.js: on Lambda, the container that issued a token is
// usually not the container that sees it again. An in-process cache also loses
// every outstanding refresh token on a cold start, silently ending sessions.
//
// Rotation is what makes this a security control rather than bookkeeping. Each
// refresh consumes its row and writes a new one, so a stolen refresh token
// stops working the moment the legitimate client refreshes -- and the absence
// of an expected row is itself evidence of replay.
import mongoose from "mongoose";

const serviceRefreshTokenSchema = new mongoose.Schema(
  {
    // SHA-256 of the token. Storing the token itself would make database read
    // access equivalent to holding every live session.
    tokenHash: {
      type: String,
      required: true,
      unique: true,
    },

    userId: { type: String, required: true },
    clientId: { type: String, required: true },
    scopes: { type: [String], required: true, default: () => [] },

    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

serviceRefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Revoking a grant should be able to drop every outstanding token for it.
serviceRefreshTokenSchema.index({ userId: 1, clientId: 1 });

const ServiceRefreshToken = mongoose.model("ServiceRefreshToken", serviceRefreshTokenSchema);

export default ServiceRefreshToken;
