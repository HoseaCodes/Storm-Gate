import User from "../models/user.js";
// import Payments from "../models/payment.js";
import Logger from "../utils/logger.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { cache } from "../utils/cache.js";
import { createAccessToken, createRefreshToken, authRole } from "../utils/auth.js";
import BlogUser from "../models/blogUser.js";
import UnregisteredUser from "../models/unregisteredUser.js";
import { sendApprovalEmail, sendRegistrationPendingEmail } from "../utils/email.js";

const logger = new Logger("users");

async function register(req, res) {
  try {
    let { name, email, username, password, role, application, status } = req.body;
    // User is role 0
    // Admin is role 1
    
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

    // Determine user status
    let userStatus = status || "APPROVED"; // Default to APPROVED for backward compatibility
    if (status && status === "PENDING") {
      userStatus = "PENDING";
    }

    const createNewUser = async (application) => {
      const userData = {
        name,
        email,
        password: passwordHash,
        application,
        role: role || "basic",
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
      path: "/api/user/refresh_token",
      maxAge: 7 * 25 * 60 * 60 * 1000,
    });

    res.json({ accesstoken, status: "Successful" });
  } catch (err) {
    logger.error('Registration error:', err);
    return res.status(500).json({ msg: err.message });
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
    return res.status(500).json({ msg: err.message, err: err });
  }
}

async function login(req, res) {
  try {
    const { email, password, rememberMe } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ msg: "User does not exist." });

    // Check user status
    if (user.status === "DENIED") {
      return res.status(403).json({ 
        msg: "Your account registration has been denied. Please contact support.",
        status: "DENIED"
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ msg: "Invalid password" });

    const accesstoken = createAccessToken({ id: user._id });
    const refreshtoken = createRefreshToken({ id: user._id });

    if (rememberMe) {
      // Only set cookies if user checks remember me
      res.cookie("refreshtoken", refreshtoken, {
        httpOnly: true,
        path: "/api/user/refresh_token",
        maxAge: 7 * 25 * 60 * 60 * 1000,
      });
    }
    res.cookie("accesstoken", accesstoken, {
      maxAge: 7 * 25 * 60 * 60 * 1000,
      path: "/api/user/login",
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
    return res.status(500).json({ msg: err.message });
  }
}

async function logout(req, res) {
  try {
    res.clearCookie("refreshtoken", { path: "/api/user/refresh_token" });
    return res.json({ msg: "Logged Out", status: "Successful"});
  } catch (err) {
    return res.status(500).json({ msg: err.message });
  }
}

async function getAllUsers(req, res) {
  try {
    const users = await User.find();
    if (!users) return res.status(400).json({ msg: "No users exist" });
    let granted = true;
    const access = ["basic", "supervisor", "admin"];
    granted = authRole(access, users);
    const unregisteredUser = await UnregisteredUser.find();
    if (!granted) {
      return res.status(401).json({
        error:
          "Not allowed: You don't have enough permission to perform this action",
      });
    }
    logger.info("Returning all of the users");

    res.cookie("users-cache", users.length + "users", {
      maxAge: 1000 * 60 * 60, // would expire after an hour
      httpOnly: true, // The cookie only accessible by the web server
    });

    cache.set(users.length + "users", {
      status: "success",
      users: [users, unregisteredUser],
      result: users.length + unregisteredUser.length,
      location: "cache",
    });

    res.json({
      status: "success",
      users: users,
      unregisteredUser: unregisteredUser,
      allUsers: [users, unregisteredUser],
      result: users.length + unregisteredUser.length,
      location: "main",
    });
  } catch (err) {
    logger.error(err);

    return res.status(500).json({ msg: err.message });
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
//     return res.status(500).json({ msg: err.message });
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
//     return res.status(500).json({ msg: err.message });
//   }
// }

async function getUser(req, res) {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) return res.status(400).json({ msg: "User does not exist" });
    let granted = true;
    const access = ["basic", "supervisor", "admin"];
    granted = authRole(access, user);
    if (!granted) {
      return res.status(401).json({
        error:
          "Not allowed: You don't have enough permission to perform this action",
      });
    }
    res.cookie("user-cache", user.id + "user", {
      maxAge: 1000 * 60 * 60, // would expire after an hour
      httpOnly: true, // The cookie only accessible by the web server
    });

    cache.set(user.id + "user", {
      status: "success",
      user: user,
      result: user.length,
      location: "cache",
    });

    res.json({
      status: "success",
      users: user,
      result: user.length,
      location: "main",
    });
  } catch (err) {
    return res.status(500).json({ msg: err.message });
  }
}

async function updateProfile(req, res) {
  try {
    const {
      notifications,
      favoriteArticles,
      savedArticles,
      likedArticles,
    } = req.body;

    const originalBody = req.body;
    const userId = req.params.id;
    const originalUser = await User.findOne({ _id: userId });
    let granted = true;
    const access = ["auperAdmin", "admin"];
    granted = authRole(access, originalUser);
    if (!granted) {
      return res.status(401).json({
        error:
          "Not allowed: You don't have enough permission to perform this action",
      });
    }
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
    return res.status(500).json({ msg: err.message });
  }
}

async function deleteProfile(req, res) {
  try {
    const userId = req.params.id;
    logger.info(`Deleted user ${userId} has been deleted`);
    const user = await User.findById(userId);
    let granted = true;
    const access = ["admin"];
    granted = authRole(access, user);
    if (!granted) {
      return res.status(401).json({
        error:
          "Not allowed: You don't have enough permission to perform this action",
      });
    }
    await User.findByIdAndDelete(userId);

    res.clearCookie("users-cache");
    res.clearCookie("user-cache");

    res.json({ msg: "User has been deleted", data: null, status: "Successful"});
  } catch (err) {
    logger.error(err);

    return res.status(500).json({ msg: err.message });
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
    return res.status(500).json({ msg: err.message });
  }
}

async function getUsers(req, res) {
  try {
    const users = await User.find();
    res.status(200).json(users);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
}

async function addUser(req, res) {
  const user = req.body;
  const newUser = new Users(user);
  try {
    await newUser.save();
    res.status(201).json(newUser);
  } catch (error) {
    res.status(409).json({ message: error.message });
  }
}

async function getUserById(req, res) {
  try {
    const user = await User.findById(req.params.id);
    res.status(200).json(user);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
}

async function editUser(req, res) {
  let user = req.body;
  const editUser = new Users(user);
  try {
    await User.updateOne({ _id: req.params.id }, editUser);
    res.status(201).json(editUser);
  } catch (error) {
    res.status(409).json({ message: error.message });
  }
}

async function deleteUser(req, res) {
  try {
    await User.deleteOne({ _id: req.params.id });
    res.status(201).json("User deleted Successfully");
  } catch (error) {
    res.status(409).json({ message: error.message });
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
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    });
  } catch (err) {
    logger.error('Get me error:', err);
    return res.status(500).json({ msg: err.message });
  }
}

async function checkUserStatus(req, res) {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ msg: "Email is required" });
    }

    const user = await User.findOne({ email }).select('email name status createdAt');
    
    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    res.json({
      status: "success",
      user: {
        email: user.email,
        name: user.name,
        status: user.status || "APPROVED",
        registeredAt: user.createdAt
      }
    });
  } catch (err) {
    logger.error('Check user status error:', err);
    return res.status(500).json({ msg: err.message });
  }
}

const userCtrl =  {
  register,
  refreshToken,
  login,
  logout,
  getUser,
  updateProfile,
  deleteProfile,
  getAllUsers,
  // addCart,
  // history,
  addProfile,
  getUsers,
  addUser,
  getUserById,
  editUser,
  deleteUser,
  getMe,
  checkUserStatus,
};

export default userCtrl;
