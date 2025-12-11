import User from "../models/user.js";
import Logger from "../utils/logger-lambda.js";
import { cache } from "../utils/cache.js";
import UnregisteredUser from "../models/unregisteredUser.js";

const logger = new Logger("users");

async function getUserById(req, res) {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) return res.status(400).json({ msg: "User does not exist" });
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

    logger.info(`User ${user.email} fetched their data.`);
    
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

async function getAllUsers(req, res) {
  try {
    const users = await User.find();
    if (!users) return res.status(400).json({ msg: "No users exist" });
    const unregisteredUser = await UnregisteredUser.find();
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

const adminCtrl =  {
    getUserById,
    getAllUsers,
};

export default adminCtrl;