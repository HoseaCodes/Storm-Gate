// POST /verify-email and POST /resend-verification (see utils/emailVerification.js).
//
// Neither reveals whether an email has an account: an unknown email, a wrong
// code, an expired code and an already-verified account all get the same
// answer, and a resend request always gets the same acknowledgement.
import User from "../models/user.js";
import Logger from "../utils/logger-lambda.js";
import { sendServerError } from "../utils/serverError.js";
import { sendVerificationCodeEmail } from "../utils/email.js";
import {
  CODE_TTL_LABEL,
  checkVerificationCode,
  isEmailVerified,
  newVerificationCode,
} from "../utils/emailVerification.js";

const logger = new Logger("email-verification");

export const INVALID_CODE = "Invalid or expired verification code";
export const RESEND_ACK = "If that account needs verification, a new code has been sent.";

export async function verifyEmail(req, res) {
  try {
    const { email, code } = req.body;
    if (typeof email !== "string" || !email || typeof code !== "string" || !code) {
      return res.status(400).json({ msg: "Email and code are required" });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ msg: INVALID_CODE });

    const outcome = checkVerificationCode(user, code);
    if (outcome === "already-verified") return res.status(400).json({ msg: INVALID_CODE });

    // Saved for both outcomes: a failure records the attempt.
    await user.save();

    if (outcome !== "verified") return res.status(400).json({ msg: INVALID_CODE });
    return res.json({ msg: "Email verified", emailVerified: true });
  } catch (err) {
    return sendServerError(res, err, logger, "Email verification error");
  }
}

export async function resendVerification(req, res) {
  try {
    const { email } = req.body;
    if (typeof email !== "string" || !email) {
      return res.status(400).json({ msg: "Email is required" });
    }

    const user = await User.findOne({ email });
    if (user && !isEmailVerified(user)) {
      const { code, fields } = newVerificationCode();
      Object.assign(user, fields);
      await user.save();
      await sendVerificationCodeEmail({ email: user.email, name: user.name, code, expiryTime: CODE_TTL_LABEL });
    }

    return res.json({ msg: RESEND_ACK });
  } catch (err) {
    return sendServerError(res, err, logger, "Resend verification error");
  }
}

export default { verifyEmail, resendVerification };
