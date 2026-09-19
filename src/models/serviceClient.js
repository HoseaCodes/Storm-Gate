// A registered service that may act on a user's behalf -- for example an MCP
// server that an assistant connects to on the user's instruction.
//
// Storm-Gate serves several applications, so nothing here is specific to any
// one of them: the scopes a client may request and the audience its tokens are
// minted for are both properties of the client record, not constants.
//
// This is the OAuth "client" record. It exists so that /oauth/authorize can
// answer two questions before it shows a consent screen: is this a client we
// know, and is this redirect_uri one it registered? Both must be answerable
// without trusting anything in the request.
import mongoose from "mongoose";

const serviceClientSchema = new mongoose.Schema(
  {
    // Public identifier. Appears in authorization URLs and as `act.sub` in
    // issued tokens, so it should be a readable slug rather than a random id.
    clientId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    // Shown to the user on the consent screen. They are agreeing to give *this*
    // access to their data, so it must be recognisable.
    name: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      trim: true,
    },

    // bcrypt hash. Confidential clients authenticate at /oauth/token with it.
    // Never stored in the clear, and never returned by any endpoint.
    //
    // Required only of confidential clients. A public client has no secret by
    // definition -- it cannot keep one -- and proves itself with PKCE instead.
    // Demanding a hash from every client made dynamic registration fail with a
    // 500 for exactly the clients that register themselves, which are the ones
    // most likely to be public.
    clientSecretHash: {
      type: String,
      required: function requiredForConfidentialClients() {
        return this.isConfidential !== false;
      },
    },

    // Exact-match allowlist. Matched by full string equality at authorize time
    // -- no prefixes, no wildcards, no subdomain rules. Every relaxation of
    // redirect matching is a documented bypass, and this codebase has already
    // been bitten once by an unvalidated redirect target.
    redirectUris: {
      type: [String],
      required: true,
      validate: {
        validator: (uris) => Array.isArray(uris) && uris.length > 0,
        message: "A service client must register at least one redirect URI",
      },
    },

    // The ceiling on what this client may ever request, and the only definition
    // of which scopes are valid for it. Scope vocabulary belongs to the
    // consuming application -- a fitness API and a blog have nothing in common
    // here -- so Storm-Gate validates against this list rather than any
    // built-in set of its own.
    allowedScopes: {
      type: [String],
      required: true,
      default: () => [],
    },

    // The `aud` claim stamped on this client's tokens: the API that will verify
    // them. Per-client, because a shared auth server issues tokens for several
    // different APIs and a token minted for one must not be accepted by another.
    audience: {
      type: String,
      required: true,
      trim: true,
    },

    // Public clients (a desktop client that cannot hold a secret) use PKCE
    // alone. Confidential clients must also present the secret.
    isConfidential: {
      type: Boolean,
      default: true,
    },

    status: {
      type: String,
      enum: ["active", "disabled"],
      default: "active",
    },
  },
  { timestamps: true }
);

// Disabled clients must stop working immediately, so status is part of every
// lookup rather than a post-filter a caller could forget.
serviceClientSchema.index({ clientId: 1, status: 1 });

const ServiceClient = mongoose.model("ServiceClient", serviceClientSchema);

export default ServiceClient;
