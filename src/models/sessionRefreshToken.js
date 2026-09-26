// Refresh tokens for user sign-in sessions (login, sign-up, refresh).
//
// These used to be stateless 7-day JWTs: nothing could revoke one, logout only
// cleared a cookie, and a stolen token kept working until it expired. They are
// now random values stored here, rotated on every use, and grouped into a
// family per sign-in so a replayed token can end the whole session.
//
// Kept in MongoDB for the same reason as serviceRefreshToken.js: on Lambda the
// container that issued a token is usually not the one that sees it again.
import mongoose from "mongoose";

const sessionRefreshTokenSchema = new mongoose.Schema(
  {
    // SHA-256 of the token; the token itself is never stored.
    tokenHash: { type: String, required: true, unique: true },
    userId: { type: String, required: true },
    // Every token descended from one sign-in shares a familyId.
    familyId: { type: String, required: true },
    // Set when the token is exchanged for its successor. A used token is kept
    // until it expires so a second presentation can be recognised as replay.
    usedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

sessionRefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
sessionRefreshTokenSchema.index({ familyId: 1 });
sessionRefreshTokenSchema.index({ userId: 1 });

const SessionRefreshToken = mongoose.model("SessionRefreshToken", sessionRefreshTokenSchema);

export default SessionRefreshToken;
