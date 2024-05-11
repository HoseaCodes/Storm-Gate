import User from "../models/user.js";
// import Payments from "../models/payment.js";
import Logger from "../utils/logger.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { cache } from "../utils/cache.js";
import { createAccessToken, createRefreshToken } from "../utils/auth.js";
import BlogUser from "../models/blogUser.js";
const logger = new Logger("users");

async function register(req, res) {
  try {
    let { name, email, password, role, application } = req.body;
    // User is role 0
    // Admin is role 1
    const user = await User.findOne({ email });
    if (user)
      return res
        .status(409)
        .json({ msg: "Conflict: The email already exists" });

    if (password.length < 6)
      return res
        .status(401)
        .json({ msg: "Password is at least 6 characters long" });

    //Password Encryption
    const passwordHash = await bcrypt.hash(password, 10);

    const newUser = async (application) => {
      switch (application) {
        case "blog":
          const blog = new BlogUser({
            name,
            email,
            password: passwordHash,
            application,
            aboutMe: "About me",
          });
          return await blog.save();
        case "ecommerce":
          break;
        case "social":
          break;
        default:
          const newUser = new User({
            name,
            email,
            password: passwordHash,
            role,
            application,
          });
          return await newUser.save();
      }
    }

    newUser(application);

    //Create jsonwebtoken for authentication
    const accesstoken = createAccessToken({ id: newUser._id });
    const refreshtoken = createRefreshToken({ id: newUser._id });

    res.cookie("refreshtoken", refreshtoken, {
      httpOnly: true,
      path: "/api/user/refresh_token",
      maxAge: 7 * 25 * 60 * 60 * 1000,
    });

    res.json({ accesstoken });
  } catch (err) {
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

    res.json({ accesstoken });
  } catch (err) {
    return res.status(500).json({ msg: err.message });
  }
}

async function logout(req, res) {
  try {
    res.clearCookie("refreshtoken", { path: "/api/user/refresh_token" });
    return res.json({ msg: "Logged Out" });
  } catch (err) {
    return res.status(500).json({ msg: err.message });
  }
}

async function getAllUsers(req, res) {
  try {
    const users = await User.find();

    logger.info("Returning all of the users");

    res.cookie("users-cache", users.length + "users", {
      maxAge: 1000 * 60 * 60, // would expire after an hour
      httpOnly: true, // The cookie only accessible by the web server
    });

    cache.set(users.length + "users", {
      status: "success",
      users: users,
      result: users.length,
      location: "cache",
    });

    res.json({
      status: "success",
      users: users,
      result: users.length,
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

    res.cookie("user-cache", user.id + "user", {
      maxAge: 1000 * 60 * 60, // would expire after an hour
      httpOnly: true, // The cookie only accessible by the web server
    });

    cache.set(user.id + "user", {
      status: "success",
      users: user,
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
      name,
      avatar,
      title,
      work,
      education,
      skills,
      location,
      phone,
      socialMedia,
      websites,
      socialMediaHandles,
      articles,
      cart,
      role,
      username,
      aboutMe,
      projects,
      notifications,
      favoriteArticles,
      savedArticles,
      likedArticles,
    } = req.body;

    const originalBody = req.body;
    const originalUser = await User.findOne({ _id: req.params.id });
    if (originalBody.notifications) {
      const newNotifications = originalUser.notifications.concat(notifications);
      const uniqueNotifications = [...new Set(newNotifications)];
      console.log({ newNotifications });
      await User.findOneAndUpdate(
        { _id: req.params.id },
        {
          notifications: uniqueNotifications,
        }
      );
    }

    if (originalBody.favoriteArticles) {
      console.log(`favoriteArticles`);
      const newFavoriteArticles = originalUser.favoriteArticles.concat(
        favoriteArticles
      );
      const uniqueFavoriteArticles = [...new Set(newFavoriteArticles)];
      await User.findOneAndUpdate(
        { _id: req.params.id },
        {
          favoriteArticles: uniqueFavoriteArticles,
        }
      );
    }

    if (originalBody.savedArticles) {
      console.log(`savedArticles`);
      const newSavedArticles = originalUser.savedArticles.concat(savedArticles);
      const uniqueSavedArticles = [...new Set(newSavedArticles)];
      console.log({ newSavedArticles });
      await User.findOneAndUpdate(
        { _id: req.params.id },
        {
          savedArticles: uniqueSavedArticles,
        }
      );
    }

    if (originalBody.likedArticles) {
      console.log(`likedArticles`);
      const newLikedArticles = originalUser.likedArticles.concat(likedArticles);
      const uniqueLikedArticles = [...new Set(newLikedArticles)];
      console.log({ newLikedArticles });
      await User.findOneAndUpdate(
        { _id: req.params.id },
        {
          likedArticles: uniqueLikedArticles,
        }
      );
    }

    // await User.findOneAndUpdate(
    //   { _id: req.params.id },
    //   {
    //     name,
    //     avatar,
    //     title,
    //     work,
    //     education,
    //     skills,
    //     location,
    //     phone,
    //     socialMedia,
    //     websites,
    //     socialMediaHandles,
    //     articles,
    //     cart,
    //     role,
    //     username,
    //     aboutMe,
    //     projects
    //   }
    // );

    res.clearCookie("users-cache");
    res.clearCookie("user-cache");

    res.json({ msg: "Updated profile" });
  } catch (err) {
    logger.error(err);
    console.log(err.message);
    return res.status(500).json({ msg: err.message });
  }
}

async function deleteProfile(req, res) {
  try {
    logger.info(`Deleted user ${req.params.id} has been deleted`);

    await User.findByIdAndDelete(req.params.id);

    res.clearCookie("users-cache");
    res.clearCookie("user-cache");

    res.json({ msg: "Deleted user" });
  } catch (err) {
    logger.error(err);

    return res.status(500).json({ msg: err.message });
  }
}

export {
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
};
