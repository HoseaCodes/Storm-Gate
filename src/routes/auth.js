import express from 'express';
import authCtrl from '../controllers/auth.js';
const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: Authentication management
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
router.post("/register", authCtrl.register);

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
router.post("/login", authCtrl.login);

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
router.post("/logout", authCtrl.logout);

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
router.get("/refresh_token", authCtrl.refreshToken);

/**
 * @swagger
 * /api/user/forgot-password:
 *   post:
 *     summary: Request password reset
 *     description: Request a password reset email with a reset token
 *     tags: [User]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: user@example.com
 *     responses:
 *       200:
 *         description: Password reset email sent (if account exists)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 msg:
 *                   type: string
 *                   example: If an account with that email exists, a password reset link has been sent.
 *                 status:
 *                   type: string
 *                   example: success
 *       400:
 *         description: Bad request - email required or Azure AD user
 *       500:
 *         description: Internal Server Error
 */
router.post("/forgot-password", authCtrl.requestPasswordReset);

/**
 * @swagger
 * /api/user/reset-password/{token}:
 *   get:
 *     summary: Verify password reset token
 *     description: Verify if a password reset token is valid
 *     tags: [User]
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Password reset token from email
 *     responses:
 *       200:
 *         description: Token is valid
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 msg:
 *                   type: string
 *                   example: Token is valid
 *                 status:
 *                   type: string
 *                   example: success
 *                 email:
 *                   type: string
 *                   example: user@example.com
 *       400:
 *         description: Invalid or expired token
 *       500:
 *         description: Internal Server Error
 *   post:
 *     summary: Reset password with token
 *     description: Reset user password using a valid reset token
 *     tags: [User]
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Password reset token from email
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - password
 *             properties:
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 6
 *                 example: newSecurePassword123
 *     responses:
 *       200:
 *         description: Password reset successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 msg:
 *                   type: string
 *                   example: Password has been successfully reset. You can now login with your new password.
 *                 status:
 *                   type: string
 *                   example: success
 *       400:
 *         description: Invalid or expired token, or invalid password
 *       500:
 *         description: Internal Server Error
 */
router.post("/verify-reset-token/:token", authCtrl.verifyResetToken);

/**
 * @swagger
 * /api/user/reset-password/{token}:
 *   post:
 *     summary: Reset password with token
 *     description: Reset user password using a valid reset token
 *     tags: [User]
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Password reset token from email
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - password
 *             properties:
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 6
 *                 example: newSecurePassword123
 *     responses:
 *       200:
 *         description: Password reset successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 msg:
 *                   type: string
 *                   example: Password has been successfully reset. You can now login with your new password.
 *                 status:
 *                   type: string
 *                   example: success
 *       400:
 *         description: Invalid or expired token, or invalid password
 *       500:
 *         description: Internal Server Error
 */ 
router.post("/reset-password/:token", authCtrl.resetPassword);

export default router;
