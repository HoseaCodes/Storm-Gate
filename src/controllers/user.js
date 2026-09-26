import User from "../models/user.js";
// import Payments from "../models/payment.js";
import Logger from "../utils/logger-lambda.js";
import bcrypt from "bcrypt";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { cache } from "../utils/cache.js";
import { createAccessToken, createRefreshToken } from "../utils/auth.js";
import BlogUser from "../models/blogUser.js";
import UnregisteredUser from "../models/unregisteredUser.js";
import { sendApprovalEmail, sendRegistrationPendingEmail } from "../utils/email.js";
import { REGISTRATION_ROLE, resolveRegistrationStatus, stripProtectedUserFields } from "../utils/registration.js";

import { sendServerError } from "../utils/serverError.js";
import { verifyCredentials, INVALID_CREDENTIALS } from "../utils/credentials.js";
const logger = new Logger("users");

async function register(req, res) {
  try {
    // role and status are server-decided; see utils/registration.js.
    let { name, email, username, password, application, status: requestedStatus } = req.body;
    if (req.body.role !== undefined) {
      logger.info(`Ignored client-supplied role on registration for ${application || 'default'} application`);
    }

    const existingUser = await User.findOne({
      $or: [
        { email }, 
        ...(username ? [{ username }] : [])
      ]
    });

    
    if (existingUser) {
      logger.error(`Signup attempt with existing ${existingUser.email === email ? 'email' : 'username'}`);
      return res
        .status(409)
        .json({ message: `${existingUser.email === email ? 'Email' : 'Username'} already exists` });
    }

    if (password.length < 6)
      return res
        .status(401)
        .json({ msg: "Password is at least 6 characters long" });

    //Password Encryption
    const passwordHash = await bcrypt.hash(password, 10);

    const userStatus = resolveRegistrationStatus({ application, requestedStatus });

    const createNewUser = async (application) => {
      const userData = {
        name,
        email,
        password: passwordHash,
        application,
        role: REGISTRATION_ROLE,
        status: userStatus
      };

      switch (application) {
        case "blog":
          const blog = new BlogUser({
            ...userData,
            aboutMe: "About me",
          });
          return await blog.save();
        case "ecommerce":
          // Future implementation
          break;
        case "social":
          // Future implementation
          break;
        default:
          const newUser = new User(userData);
          return await newUser.save();
      }
    };

    const savedUser = await createNewUser(application);

    if (!savedUser) {
      return res.status(500).json({ msg: "Failed to create user" });
    }

    // Handle pending approval workflow
    if (userStatus === "PENDING") {
      try {
        // Send approval email to admin
        console.log(`Attempting to send approval email for user: ${email}`);
        logger.info(`Attempting to send approval email for user: ${email}`);
        const emailSent = await sendApprovalEmail({ email, name });
        
        if (emailSent) {
          logger.info(`Approval email sent successfully for user: ${email}`);
        } else {
          logger.warn(`Failed to send approval email for user: ${email}`);
        }
        
        // Send confirmation email to user
        logger.info(`Attempting to send pending registration email to user: ${email}`);
        const userEmailSent = await sendRegistrationPendingEmail({ email, name });
        
        if (userEmailSent) {
          logger.info(`Pending registration email sent successfully to user: ${email}`);
        } else {
          logger.warn(`Failed to send pending registration email to user: ${email}`);
        }
      } catch (emailError) {
        logger.error(`Email sending error for user ${email}:`, emailError);
        // Don't fail registration if email fails
      }
      
      return res.status(201).json({ 
        msg: "Registration successful. Your account is pending approval.",
        status: "PENDING",
        requiresApproval: true
      });
    }

    // For approved users, create tokens and proceed normally
    const accesstoken = createAccessToken({ id: savedUser._id });
    const refreshtoken = createRefreshToken({ id: savedUser._id });

    res.cookie("refreshtoken", refreshtoken, {
      httpOnly: true,
      path: "/api/auth/refresh_token",
      maxAge: 7 * 25 * 60 * 60 * 1000,
    });

    res.json({ accesstoken, status: "Successful" });
  } catch (err) {
    logger.error('Registration error:', err);
    return sendServerError(res, err, logger);
  }
}

function refreshToken(req, res) {
  try {
    let rf_token = req.cookies.refreshtoken;
    if (rf_token)
      rf_token = rf_token = req.cookies.refreshtoken.replace(/^JWT\s/, "");
    if (!rf_token)
      return res.status(400).json({ msg: "Please Login or Register" });

    jwt.verify(rf_token, process.env.REFRESH_TOKEN_SECRET, (err, user) => {
      if (err)
        return res
          .status(400)
          .json({ msg: "Please Verify Info & Login or Register" });

      const accesstoken = createAccessToken({ id: user.id });

      res.json({ accesstoken });
    });
  } catch (err) {
    return sendServerError(res, err, logger);
  }
}

async function login(req, res) {
  try {
    const { email, password, rememberMe } = req.body;

    // A non-string email (e.g. {"$regex": "^a"}) would become a query operator.
    const user = typeof email === "string" ? await User.findOne({ email }) : null;

    // One bcrypt comparison and one message for every failure, so neither the
    // response nor its timing reveals whether the email has an account.
    const isMatch = await verifyCredentials(user, password);
    if (!isMatch) return res.status(400).json({ msg: INVALID_CREDENTIALS });

    // Only someone holding the password learns the account was denied.
    if (user.status === "DENIED") {
      return res.status(403).json({ 
        msg: "Your account registration has been denied. Please contact support.",
        status: "DENIED"
      });
    }

    const accesstoken = createAccessToken({ id: user._id });
    const refreshtoken = createRefreshToken({ id: user._id });

    if (rememberMe) {
      // Only set cookies if user checks remember me
      res.cookie("refreshtoken", refreshtoken, {
        httpOnly: true,
        path: "/api/auth/refresh_token",
        maxAge: 7 * 25 * 60 * 60 * 1000,
      });
    }
    res.cookie("accesstoken", accesstoken, {
      maxAge: 7 * 25 * 60 * 60 * 1000,
      path: "/api/auth/login",
      httpOnly: true,
    });

    // Different response for pending users
    if (user.status === "PENDING") {
      return res.json({ 
        accesstoken, 
        status: "PENDING",
        msg: "Login successful. Your account is pending approval - limited access.",
        limitedAccess: true
      });
    }

    res.json({ accesstoken, status: "Successful"});
  } catch (err) {
    return sendServerError(res, err, logger);
  }
}

async function logout(req, res) {
  try {
    res.clearCookie("refreshtoken", { path: "/api/auth/refresh_token" });
    return res.json({ msg: "Logged Out", status: "Successful"});
  } catch (err) {
    return sendServerError(res, err, logger);
  }
}

// async function addCart(req, res) {
//   try {
//     const user = await User.findById(req.user.id);
//     if (!user) return res.status(400).json({ msg: "User does not exist" });

//     console.log(req.body.cart);

//     await User.findByIdAndUpdate(
//       { _id: req.user.id },
//       {
//         cart: req.body.cart,
//       }
//     );

//     res.clearCookie("history-cache");

//     return res.json({ msg: "Added to cart" });
//   } catch (err) {
//     return sendServerError(res, err, logger);
//   }
// }

// async function history(req, res) {
//   try {
//     const history = await Payments.find({ user_id: req.user.id });

//     res.cookie("history-cache", history.length + "history", {
//       maxAge: 1000 * 60 * 60, // would expire after an hour
//       httpOnly: true, // The cookie only accessible by the web server
//     });

//     cache.set(history.length + "history", {
//       status: "success",
//       result: history,
//       location: "cache",
//     });
//     return res.json({
//       status: "success",
//       result: history,
//       location: "main",
//     });
//   } catch (err) {
//     return sendServerError(res, err, logger);
//   }
// }

async function updateProfile(req, res) {
  try {
    const {
      notifications,
      favoriteArticles,
      savedArticles,
      likedArticles,
    } = req.body;

    const { allowed: originalBody, removed } = stripProtectedUserFields(req.body);
    if (removed.length) {
      logger.info(`Ignored protected fields on profile update: ${removed.join(', ')}`);
    }
    const userId = req.params.id;
    const originalUser = await User.findOne({ _id: userId });
    // let granted = true;
    // const access = ["auperAdmin", "admin"];
    // granted = authRole(access, originalUser);
    // if (!granted) {
    //   return res.status(401).json({
    //     error:
    //       "Not allowed: You don't have enough permission to perform this action",
    //   });
    // }
    if (originalBody.notifications) {
      const newNotifications = originalUser.notifications.concat(notifications);
      const uniqueNotifications = [...new Set(newNotifications)];
      console.log({ newNotifications });
      await User.findOneAndUpdate(
        { _id: userId },
        {
          notifications: uniqueNotifications,
        }
      );
      delete originalBody["notifications"];
    }

    if (originalBody.favoriteArticles) {
      const newFavoriteArticles = originalUser.favoriteArticles.concat(
        favoriteArticles
      );
      const uniqueFavoriteArticles = [...new Set(newFavoriteArticles)];
      await User.findOneAndUpdate(
        { _id: userId },
        {
          favoriteArticles: uniqueFavoriteArticles,
        }
      );
      delete originalBody["favoriteArticles"];
    }

    if (originalBody.savedArticles) {
      const newSavedArticles = originalUser.savedArticles.concat(savedArticles);
      const uniqueSavedArticles = [...new Set(newSavedArticles)];
      await User.findOneAndUpdate(
        { _id: userId },
        {
          savedArticles: uniqueSavedArticles,
        }
      );
      delete originalBody["savedArticles"];
    }

    if (originalBody.likedArticles) {
      const newLikedArticles = originalUser.likedArticles.concat(likedArticles);
      const uniqueLikedArticles = [...new Set(newLikedArticles)];
      console.log({ newLikedArticles });
      await User.findOneAndUpdate(
        { _id: userId },
        {
          likedArticles: uniqueLikedArticles,
        }
      );
      delete originalBody["likedArticles"];
    }

    const user = await User.findOneAndUpdate(
      { _id: userId },
      {
        ...originalBody,
      }
    );

    res.clearCookie("users-cache");
    res.clearCookie("user-cache");

    res.json({ msg: "Updated profile", data: user, status: "Successful"});
  } catch (err) {
    logger.error(err);
    console.log(err.message);
    return sendServerError(res, err, logger);
  }
}

async function deleteProfile(req, res) {
  try {
    const userId = req.params.id;
    logger.info(`Deleted user ${userId} has been deleted`);
    const user = await User.findById(userId);
    // let granted = true;
    // const access = ["admin"];
    // granted = authRole(access, user);
    // if (!granted) {
    //   return res.status(401).json({
    //     error:
    //       "Not allowed: You don't have enough permission to perform this action",
    //   });
    // }
    await User.findByIdAndDelete(userId);

    res.clearCookie("users-cache");
    res.clearCookie("user-cache");

    res.json({ msg: "User has been deleted", data: null, status: "Successful"});
  } catch (err) {
    logger.error(err);

    return sendServerError(res, err, logger);
  }
}

async function addProfile(req, res) {
  try {
    const { images, user } = req.body;
    const { name, bio } = user;
    const newUser = new UnregisteredUser({
      images,
      name,
      bio,
    });
    await newUser.save();
    return res.json({ data: newUser, msg: "Added Profile Successful", status: "Successful"});
  } catch (err) {
    console.log(err);
    return sendServerError(res, err, logger);
  }
}

async function addUser(req, res) {
  const user = req.body;
  const newUser = new Users(user);
  try {
    await newUser.save();
    res.status(201).json(newUser);
  } catch (error) {
    logger.error('addUser failed', { message: error.message });
    res.status(409).json({ message: 'Could not create user' });
  }
}

async function getUserById(req, res) {
  try {
    const user = await User.findById(req.params.id);
    res.status(200).json(user);
  } catch (error) {
    logger.error('getUserById failed', { message: error.message });
    res.status(404).json({ message: 'User not found' });
  }
}

async function editUser(req, res) {
  let user = req.body;
  const editUser = new Users(user);
  try {
    await User.updateOne({ _id: req.params.id }, editUser);
    res.status(201).json(editUser);
  } catch (error) {
    logger.error('editUser failed', { message: error.message });
    res.status(409).json({ message: 'Could not update user' });
  }
}

async function deleteUser(req, res) {
  try {
    await User.deleteOne({ _id: req.params.id });
    res.status(201).json("User deleted Successfully");
  } catch (error) {
    logger.error('deleteUser failed', { message: error.message });
    res.status(409).json({ message: 'Could not delete user' });
  }
}

async function getMe(req, res) {
  try {
    // req.user should contain the user ID from JWT verification
    const userId = req.user.id;
    
    if (!userId) {
      return res.status(401).json({ msg: "Invalid token: user ID not found" });
    }

    const user = await User.findById(userId).select('-password');
    
    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    // Return user information including approval status
    res.json({
      status: "success",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        username: user.username,
        role: user.role,
        status: user.status || "APPROVED", // Default to APPROVED for backward compatibility
        // Which application the account was created for, so a consuming app
        // can refuse accounts that belong to another one.
        application: user.application ?? null,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    });
  } catch (err) {
    logger.error('Get me error:', err);
    return sendServerError(res, err, logger);
  }
}

async function checkUserStatus(req, res) {
  try {
    const { email } = req.body;
    
    if (typeof email !== "string" || !email) {
      return res.status(400).json({ msg: "Email is required" });
    }

    // Public and unauthenticated, so it answers only what a pending-approval
    // page needs. It used to return the account holder's name and sign-up date
    // for any email.
    const user = await User.findOne({ email }).select('email status');

    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    res.json({
      status: "success",
      user: {
        email: user.email,
        status: user.status || "APPROVED"
      }
    });
  } catch (err) {
    return sendServerError(res, err, logger, 'Check user status error');
  }
}

/**
 * Request password reset
 * POST /api/user/forgot-password
 */
async function requestPasswordReset(req, res) {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ msg: "Email is required" });
    }

    const user = await User.findOne({ email });
    
    // Don't reveal if user exists or not for security
    if (!user) {
      return res.json({ 
        msg: "If an account with that email exists, a password reset link has been sent.",
        status: "success"
      });
    }

    // Check if user uses Azure AD authentication
    if (user.authProvider === 'azure-ad') {
      return res.status(400).json({ 
        msg: "This account uses Azure AD authentication. Please reset your password through your organization's Azure AD portal."
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    
    // Hash token and set to resetPasswordToken field
    const resetPasswordToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');

    // Set expire time (10 minutes)
    user.resetPasswordToken = resetPasswordToken;
    user.resetPasswordExpires = Date.now() + 20 * 60 * 1000; // 20 minutes

    // Save hashed token to database
    await user.save();

    // Send password reset email
    const { sendPasswordResetEmail } = await import('../utils/email.js');
    await sendPasswordResetEmail({
      email: user.email,
      name: user.name,
      resetToken
    });

    logger.info(`Password reset requested for user: ${email}`);
    
    res.json({ 
      msg: "If an account with that email exists, a password reset link has been sent.",
      status: "success"
    });
  } catch (err) {
    logger.error('Request password reset error:', err);
    return res.status(500).json({ msg: "Failed to process password reset request" });
  }
}

/**
 * Verify reset token
 * GET /api/user/reset-password/:token
 */
async function verifyResetToken(req, res) {
  try {
    const { token } = req.params;
    
    if (!token) {
      return res.status(400).json({ msg: "Reset token is required" });
    }

    // Reset tokens are random bytes, not JWTs, and the database stores their
    // SHA-256 digest. Look the user up by that digest — the same way
    // resetPassword does — so a stolen database still cannot be used to reset
    // anyone's password.
    const resetPasswordToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    const user = await User.findOne({
      resetPasswordToken,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ msg: "Invalid or expired reset token" });
    }

    res.json({ 
      msg: "Token is valid",
      status: "success",
      email: user.email
    });
  } catch (err) {
    logger.error('Verify reset token error:', err);
    return res.status(500).json({ msg: "Failed to verify reset token" });
  }
}

/**
 * Reset password
 * POST /api/user/reset-password/:token
 */
async function resetPassword(req, res) {
  try {
    const { token } = req.params;
    const { password } = req.body;
    
    if (!token) {
      return res.status(400).json({ msg: "Reset token is required" });
    }

    if (!password) {
      return res.status(400).json({ msg: "New password is required" });
    }

    if (password.length < 6) {
      return res.status(400).json({ msg: "Password must be at least 6 characters long" });
    }

    // Hash the token from params to compare with stored hash
    const resetPasswordToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');

    // Find user with valid token and non-expired token
    const user = await User.findOne({
      resetPasswordToken,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ msg: "Invalid or expired reset token" });
    }

    // Check if token has expired
    if (Date.now() > user.resetPasswordExpires) {
      return res.status(400).json({ msg: "Reset token has expired" });
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(password, 10);
    
    // Update user password and clear reset token
    user.password = passwordHash;
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    await user.save();

    logger.info(`Password successfully reset for user: ${user.email}`);
    
    res.json({ 
      msg: "Password has been successfully reset. You can now login with your new password.",
      status: "success"
    });
  } catch (err) {
    logger.error('Reset password error:', err);
    return res.status(500).json({ msg: "Failed to reset password" });
  }
}

const userCtrl =  {
  register,
  refreshToken,
  login,
  logout,
  updateProfile,
  deleteProfile,
  // addCart,
  // history,
  addProfile,
  addUser,
  getUserById,
  editUser,
  deleteUser,
  getMe,
  checkUserStatus,
  requestPasswordReset,
  verifyResetToken,
  resetPassword,
};

export default userCtrl;
