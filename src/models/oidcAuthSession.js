// In-flight OIDC login state.
//
// Holds what the /callback needs to complete an authorization it did not start:
// the PKCE verifier, which application the login was for, and where to send the
// user afterwards.
//
// Previously a process-local Map, which is the single reason these routes could
// not be mounted on the Lambda entrypoint -- /login and /callback are separate
// requests and Lambda gives no guarantee they share a container.
//
// `state` is the CSRF token for the flow, so only its digest is stored: a read
// of this collection yields nothing that could be used to forge a callback.
import mongoose from "mongoose";

const oidcAuthSessionSchema = new mongoose.Schema(
  {
    stateHash: {
      type: String,
      required: true,
      unique: true,
    },

    // The PKCE verifier. It must be stored because the server presents it at
    // the token exchange, and it is why these rows are kept short-lived.
    codeVerifier: {
      type: String,
      required: true,
    },

    application: { type: String, default: 'default' },

    // Already validated against the allowlist before the session was created,
    // and re-validated at redirect time.
    returnUrl: { type: String, default: null },

    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

// Cleanup only. The TTL monitor runs about once a minute, so consumption also
// compares expiresAt rather than trusting a row's existence to mean it is live.
oidcAuthSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const OidcAuthSession = mongoose.model("OidcAuthSession", oidcAuthSessionSchema);

export default OidcAuthSession;
