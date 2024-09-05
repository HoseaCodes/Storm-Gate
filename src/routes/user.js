
import express from 'express';
import auth from '../utils/auth.js';
import isAdmin from '../utils/authAdmin.js';
import loginRequired from '../utils/loginRequired.js';
import userCtrl from '../controllers/user.js';
const router = express.Router();
import { nodecache } from '../utils/cache.js';

/**
 * @swagger
 * tags:
 *   name: User
 *   description: User management
 */

/**
 * @swagger
 * /register:
 *   post:
 *     summary: Register a new user
 *     description: Registers a new user with the provided details
 *     tags: [User]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: The user's name
 *               email:
 *                 type: string
 *                 description: The user's email address
 *               password:
 *                 type: string
 *                 description: The user's password
 *               role:
 *                 type: string
 *                 description: The user's role
 *               application:
 *                 type: string
 *                 description: The application the user is registering for
 *     responses:
 *       200:
 *         description: User registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accesstoken:
 *                   type: string
 *                 status:
 *                   type: string
 *       409:
 *         description: Conflict - email already exists
 *       401:
 *         description: Unauthorized - invalid password length
 *       500:
 *         description: Internal Server Error
 */
router.post("/register", userCtrl.register);

/**
 * @swagger
 * /api/user/login:
 *   post:
 *     summary: User login
 *     description: Logs in a user and returns an access token and refresh token. If "remember me" is selected, a refresh token is set as a cookie.
 *     tags: [User]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 example: user@example.com
 *               password:
 *                 type: string
 *                 example: yourpassword
 *               rememberMe:
 *                 type: boolean
 *                 example: true
 *     responses:
 *       200:
 *         description: Login successful, access token and refresh token are returned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accesstoken:
 *                   type: string
 *                   description: The access token for authentication
 *                 status:
 *                   type: string
 *                   example: Successful
 *       400:
 *         description: Bad request - User does not exist or invalid password
 *       500:
 *         description: Internal Server Error
 */
router.post("/login", userCtrl.login);

/**
 * @swagger
 * /api/user/logout:
 *   post:
 *     summary: User logout
 *     description: Logs out a user by clearing the refresh token cookie and returns a success message.
 *     tags: [User]
 *     responses:
 *       200:
 *         description: Logout successful, refresh token cookie cleared
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 msg:
 *                   type: string
 *                   example: Logged Out
 *                 status:
 *                   type: string
 *                   example: Successful
 *       500:
 *         description: Internal Server Error
 */
router.post("/logout", userCtrl.logout);

/**
 * @swagger
 * /refresh_token:
 *   get:
 *     summary: Refresh the access token
 *     description: Refresh the access token using the refresh token
 *     tags: [User]
 *     responses:
 *       200:
 *         description: Access token refreshed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accesstoken:
 *                   type: string
 *       401:
 *         description: Unauthorized - Please verify info & login or register
 *       400:
 *         description: Bad request - Please login or register
 *       500:
 *         description: Internal Server Error
 */
router.get("/refresh_token", userCtrl.refreshToken);

/**
 * @swagger
 * /api/user:
 *   get:
 *     summary: Get the current user's details
 *     description: Retrieves details of the currently authenticated user, excluding the password. Includes permission checks and caching.
 *     tags: [User]
 *     responses:
 *       200:
 *         description: Successfully retrieved the user details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 users:
 *                   type: object
 *                   properties:
 *                     _id:
 *                       type: string
 *                       example: 60c72b2f9b1e8d001f647d9f
 *                     email:
 *                       type: string
 *                       example: user@example.com
 *                     // Add other user fields as needed
 *                 result:
 *                   type: integer
 *                   example: 1
 *                 location:
 *                   type: string
 *                   example: main
 *       400:
 *         description: Bad request - User does not exist
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 msg:
 *                   type: string
 *                   example: User does not exist
 *       401:
 *         description: Unauthorized - Permission denied
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Not allowed: You don't have enough permission to perform this action
 *       500:
 *         description: Internal Server Error
 */
router.get("/info", auth, nodecache, userCtrl.getUser);

// router.patch('/addcart', auth, addCart);

// router.get('/history', auth, nodecache, history);

/**
 * @swagger
 * /api/user/profile:
 *   post:
 *     summary: Add a new user profile
 *     description: Adds a new user profile with images and user details. The user is saved to the UnregisteredUser collection.
 *     tags: [User]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               images:
 *                 type: array
 *                 items:
 *                   type: string
 *               user:
 *                 type: object
 *                 properties:
 *                   name:
 *                     type: string
 *                   bio:
 *                     type: string
 *     responses:
 *       200:
 *         description: Successfully added the user profile
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     _id:
 *                       type: string
 *                       example: 60c72b2f9b1e8d001f647d9f
 *                     name:
 *                       type: string
 *                       example: John Doe
 *                     bio:
 *                       type: string
 *                       example: Software Developer
 *                     // Add other user fields as needed
 *                 msg:
 *                   type: string
 *                   example: Added Profile Successful
 *                 status:
 *                   type: string
 *                   example: Successful
 *       500:
 *         description: Internal Server Error
 */
router.post("/create", userCtrl.addProfile);

/**
 * @swagger
 * /api/user/profile/{id}:
 *   put:
 *     summary: Update a user's profile
 *     description: Updates a user's profile with new data, including notifications, favorite articles, saved articles, and liked articles. Includes permission checks.
 *     tags: [User]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           example: 60c72b2f9b1e8d001f647d9f
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notifications:
 *                 type: array
 *                 items:
 *                   type: string
 *               favoriteArticles:
 *                 type: array
 *                 items:
 *                   type: string
 *               savedArticles:
 *                 type: array
 *                 items:
 *                   type: string
 *               likedArticles:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Successfully updated the profile
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 msg:
 *                   type: string
 *                   example: Updated profile
 *                 data:
 *                   type: object
 *                   properties:
 *                     _id:
 *                       type: string
 *                       example: 60c72b2f9b1e8d001f647d9f
 *                     email:
 *                       type: string
 *                       example: user@example.com
 *                     // Add other user fields as needed
 *                 status:
 *                   type: string
 *                   example: Successful
 *       400:
 *         description: Bad request - Invalid data provided
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Not allowed: You don't have enough permission to perform this action
 *       401:
 *         description: Unauthorized - Permission denied
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Not allowed: You don't have enough permission to perform this action
 *       500:
 *         description: Internal Server Error
 */
router.route("/edit/:id").put(userCtrl.updateProfile);

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: Get all users
 *     description: Retrieves a list of all registered and unregistered users. Includes permission checks and caching of the user list.
 *     tags: [User]
 *     responses:
 *       200:
 *         description: Successfully retrieved the list of users
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 users:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       _id:
 *                         type: string
 *                         example: 60c72b2f9b1e8d001f647d9f
 *                       email:
 *                         type: string
 *                         example: user@example.com
 *                       // Add other user fields as needed
 *                 unregisteredUser:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       _id:
 *                         type: string
 *                         example: 60c72b2f9b1e8d001f647d9f
 *                       email:
 *                         type: string
 *                         example: unregistered@example.com
 *                       // Add other unregistered user fields as needed
 *                 allUsers:
 *                   type: array
 *                   items:
 *                     type: array
 *                     items:
 *                       type: object
 *                       properties:
 *                         _id:
 *                           type: string
 *                           example: 60c72b2f9b1e8d001f647d9f
 *                         email:
 *                           type: string
 *                           example: user@example.com
 *                         // Add other user fields as needed
 *                 result:
 *                   type: integer
 *                   example: 42
 *                 location:
 *                   type: string
 *                   example: main
 *       400:
 *         description: Bad request - No users exist or insufficient permissions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Not allowed: You don't have enough permission to perform this action
 *       401:
 *         description: Unauthorized - Permission denied
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Not allowed: You don't have enough permission to perform this action
 *       500:
 *         description: Internal Server Error
 */
router.get("/", userCtrl.getAllUsers);


/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: Get all users
 *     description: Retrieves a list of all users from the database.
 *     tags: [User]
 *     responses:
 *       200:
 *         description: Successfully retrieved the list of users
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   _id:
 *                     type: string
 *                     example: 60c72b2f9b1e8d001f647d9f
 *                   email:
 *                     type: string
 *                     example: user@example.com
 *                   // Add other user fields as needed
 *       404:
 *         description: Not Found - No users found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: No users found
 */
router.get("/users", userCtrl.getUsers);

/**
 * @swagger
 * /api/user:
 *   post:
 *     summary: Add a new user
 *     description: Adds a new user to the database with the provided data.
 *     tags: [User]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               // Add other user fields as needed
 *     responses:
 *       201:
 *         description: Successfully added the new user
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 _id:
 *                   type: string
 *                   example: 60c72b2f9b1e8d001f647d9f
 *                 name:
 *                   type: string
 *                   example: John Doe
 *                 email:
 *                   type: string
 *                   example: user@example.com
 *                 // Add other user fields as needed
 *       409:
 *         description: Conflict - User already exists
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: User already exists
 */
router.post("/add", userCtrl.addUser);


/**
 * @swagger
 * /api/user/{id}:
 *   get:
 *     summary: Get a user by ID
 *     description: Retrieves the details of a user by their ID.
 *     tags: [User]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           example: 60c72b2f9b1e8d001f647d9f
 *     responses:
 *       200:
 *         description: Successfully retrieved the user details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 _id:
 *                   type: string
 *                   example: 60c72b2f9b1e8d001f647d9f
 *                 email:
 *                   type: string
 *                   example: user@example.com
 *                 // Add other user fields as needed
 *       404:
 *         description: Not Found - User does not exist
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: User not found
 */
// router.get("/:id", userCtrl.getUserById);

/**
 * @swagger
 * /api/user/{id}:
 *   put:
 *     summary: Edit a user by ID
 *     description: Updates the details of a user by their ID.
 *     tags: [User]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           example: 60c72b2f9b1e8d001f647d9f
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               // Add other user fields as needed
 *     responses:
 *       201:
 *         description: Successfully updated the user
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 _id:
 *                   type: string
 *                   example: 60c72b2f9b1e8d001f647d9f
 *                 name:
 *                   type: string
 *                   example: John Doe
 *                 email:
 *                   type: string
 *                   example: user@example.com
 *                 // Add other user fields as needed
 *       409:
 *         description: Conflict - Update failed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Update failed
 */
// router.put("/:id", userCtrl.editUser);

/**
 * @swagger
 * /api/user/{id}:
 *   delete:
 *     summary: Delete a user by ID
 *     description: Deletes a user from the database by their ID.
 *     tags: [User]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           example: 60c72b2f9b1e8d001f647d9f
 *     responses:
 *       201:
 *         description: Successfully deleted the user
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 msg:
 *                   type: string
 *                   example: User deleted Successfully
 *                 data:
 *                   type: null
 *                 status:
 *                   type: string
 *                   example: Successful
 *       409:
 *         description: Conflict - Deletion failed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Deletion failed
 */
// router.delete("/:id", userCtrl.deleteUser);

router
  .route("/:id")
  .get(isAdmin, nodecache, userCtrl.getAllUsers)
  .put(loginRequired, userCtrl.updateProfile)
  .delete(loginRequired, userCtrl.deleteProfile);


export default router;
