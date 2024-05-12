
import express from 'express';
import auth from '../utils/auth.js';
import isAdmin from '../utils/authAdmin.js';
import loginRequired from '../utils/loginRequired.js';
import userCtrl from '../controllers/user.js';
const router = express.Router();
import {nodecache} from '../utils/cache.js';


router.post("/register", userCtrl.register);

router.post("/login", userCtrl.login);

router.post("/logout", userCtrl.logout);

router.get("/refresh_token", userCtrl.refreshToken);

router.get("/info", auth, nodecache, userCtrl.getUser);

// router.patch('/addcart', auth, addCart);

// router.get('/history', auth, nodecache, history);

router.post("/create", userCtrl.addProfile);

router.route("/edit/:id").put(userCtrl.updateProfile);

router.get("/", userCtrl.getAllUsers);

router.get("/users", userCtrl.getUsers);

router.post("/add", userCtrl.addUser);

// router.get("/:id", userCtrl.getUserById);

// router.put("/:id", userCtrl.editUser);

// router.delete("/:id", userCtrl.deleteUser);

router
  .route("/:id")
  .get(isAdmin, nodecache, userCtrl.getAllUsers)
  .put(loginRequired, userCtrl.updateProfile)
  .delete(loginRequired, userCtrl.deleteProfile);


export default router;
