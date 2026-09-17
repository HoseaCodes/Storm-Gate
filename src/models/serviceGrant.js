// A user's standing authorisation for one service to act on their behalf.
//
// This record -- not the access token -- is the durable statement of consent.
// Storm-Gate cannot revoke an access token (there is no denylist and no jti
// tracking), so revocation is enforced here, at refresh time: access tokens are
// short, and every refresh re-reads this grant. Worst-case exposure after a
// user revokes is one access-token lifetime.
import mongoose from "mongoose";

const serviceGrantSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Denormalised from ServiceClient.clientId so a grant can be read, listed
    // on a "connected apps" screen, and revoked without a join.
    clientId: {
      type: String,
      required: true,
      trim: true,
    },

    // The subset of the client's allowedScopes that this user approved.
    // Tokens are issued against this, never against the client's ceiling.
    scopes: {
      type: [String],
      required: true,
      default: () => [],
    },

    status: {
      type: String,
      enum: ["active", "revoked"],
      default: "active",
    },

    grantedAt: {
      type: Date,
      default: Date.now,
    },

    revokedAt: {
      type: Date,
      default: null,
    },

    // Surfaced on the connected-apps screen so a user can see which
    // integrations are actually in use before deciding what to revoke.
    lastUsedAt: {
      type: Date,
      default: null,
    },

    // Which consent text the user actually saw, so a past authorisation can be
    // reconstructed later. Consuming applications may have their own reasons to
    // need this -- a health or finance integration far more than a blog.
    consentVersion: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

// One grant per user per client. Re-authorising updates the existing row
// rather than accumulating duplicates that revocation would have to chase.
serviceGrantSchema.index({ userId: 1, clientId: 1 }, { unique: true });

// The connected-apps listing.
serviceGrantSchema.index({ userId: 1, status: 1 });

const ServiceGrant = mongoose.model("ServiceGrant", serviceGrantSchema);

export default ServiceGrant;
