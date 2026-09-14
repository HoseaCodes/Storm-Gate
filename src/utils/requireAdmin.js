import Users from "../models/user.js";

/**
 * Authorization for admin-only routes. Runs AFTER a verifier that populates
 * req.user; it answers "may this caller do this", never "who is this caller".
 *
 * Why the role is read from the database rather than the token:
 *
 * The standard access token is minted as createAccessToken({ id }) — it carries
 * no role at all. Only the OIDC exchange includes one. A middleware that trusted
 * req.user.role would therefore authorize nobody on the normal login path and,
 * worse, would authorize anyone who could get a role claim into a token. The
 * database is the single source of truth for what an account may do.
 *
 * Why guests are rejected before anything else:
 *
 * /auth/guest-login is unauthenticated — anyone can call it and receive a valid
 * token. Guest identities live in a different collection, so the lookup below
 * would miss anyway, but failing on the flag is explicit and gives a clear
 * answer rather than an accidental one.
 *
 * This deliberately does not replace utils/authAdmin.js, which is separately
 * broken (it reads req.params.id, and Users.find() returns an array so its role
 * check is always undefined). That one currently denies every request, so it
 * fails closed; repairing it would open routes that are effectively shut, which
 * is a different change from closing a hole.
 */

const ADMIN_ROLES = new Set(["admin", "superAdmin"]);

const DENIED = {
  msg: "Not allowed: you don't have permission to perform this action",
};

const requireAdmin = async (req, res, next) => {
  try {
    // No verified caller means the route is misconfigured — this middleware
    // must never be the only thing between the internet and an admin action.
    if (!req.user?.id) {
      return res.status(401).json({ msg: "Authentication required" });
    }

    if (req.user.isGuest) {
      return res.status(403).json(DENIED);
    }

    const user = await Users.findById(req.user.id).select("role status");

    // A token whose subject no longer exists is not an administrator.
    if (!user) {
      return res.status(403).json(DENIED);
    }

    if (!ADMIN_ROLES.has(user.role)) {
      return res.status(403).json(DENIED);
    }

    // An account awaiting or refused approval cannot approve others, whatever
    // role it carries.
    if (user.status !== "APPROVED") {
      return res.status(403).json(DENIED);
    }

    // Handy for audit logging in the handlers, and proof this check ran.
    req.admin = { id: String(user._id), role: user.role };
    next();
  } catch (err) {
    // Fail closed. An authorization check that cannot complete must not be
    // treated as a pass.
    return res.status(500).json({ msg: "Authorization check failed" });
  }
};

export default requireAdmin;
