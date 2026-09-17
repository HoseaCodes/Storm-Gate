// Short-lived OAuth authorization codes.
//
// These were previously held in a process-local Map. That cannot work in
// production: Storm-Gate runs on Lambda behind API Gateway, so the /authorize
// request that issues a code and the /token request that redeems it routinely
// land on different containers with different memory. It is the same reason the
// OIDC routes are not mounted on the Lambda entrypoint.
//
// Two properties this collection provides that memory did not:
//
//   * Redemption is atomic ACROSS containers. findOneAndDelete either returns
//     the document to exactly one caller or returns null, so a replayed code
//     cannot be redeemed twice even by concurrent requests on separate hosts.
//   * Expiry survives a cold start, and a TTL index reaps the rows without a
//     sweeper.
//
// The code itself is never stored. A code is a bearer credential for its whole
// (short) life, so the collection holds only a SHA-256 of it -- read access to
// the database yields nothing redeemable. SHA-256 rather than bcrypt because
// the input is 256 bits of CSPRNG output, so there is nothing to brute-force
// and the lookup is on the hot path of every token request.
import mongoose from "mongoose";

const authorizationCodeSchema = new mongoose.Schema(
  {
    codeHash: {
      type: String,
      required: true,
      unique: true,
    },

    clientId: { type: String, required: true },
    userId: { type: String, required: true },

    // Re-checked at redemption; never taken from the token request.
    redirectUri: { type: String, required: true },
    scopes: { type: [String], required: true, default: () => [] },
    codeChallenge: { type: String, required: true },

    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

// MongoDB's TTL monitor runs roughly every 60 seconds, so an expired row can
// briefly outlive its expiresAt. The TTL index is cleanup, not enforcement --
// callers must still compare expiresAt themselves.
authorizationCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const AuthorizationCode = mongoose.model("AuthorizationCode", authorizationCodeSchema);

export default AuthorizationCode;
