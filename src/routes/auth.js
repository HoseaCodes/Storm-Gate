import express from 'express';
import authController from '../controllers/auth.js';
import approvalController from '../controllers/approval.js';
import enhancedVerifyJWT from '../utils/enhancedAuth.js';

const router = express.Router();

/**
 * @swagger
 * /auth/login:
 *   get:
 *     summary: Initiate OIDC authentication with Azure AD
 *     tags: [Authentication]
 *     parameters:
 *       - in: query
 *         name: application
 *         schema:
 *           type: string
 *           enum: [blog, ecommerce, social, default]
 *         description: Target application for authentication
 *       - in: query
 *         name: return_url
 *         schema:
 *           type: string
 *         description: URL to redirect to after successful authentication
 *     responses:
 *       302:
 *         description: Redirect to Azure AD authorization endpoint
 *       500:
 *         description: Authentication service error
 */
router.get('/login', authController.initiateLogin);

/**
 * @swagger
 * /auth/callback:
 *   get:
 *     summary: Handle OAuth callback from Azure AD
 *     tags: [Authentication]
 *     parameters:
 *       - in: query
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *         description: Authorization code from Azure AD
 *       - in: query
 *         name: state
 *         required: true
 *         schema:
 *           type: string
 *         description: State parameter for CSRF protection
 *     responses:
 *       200:
 *         description: Authentication successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 message:
 *                   type: string
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     name:
 *                       type: string
 *                     email:
 *                       type: string
 *                     application:
 *                       type: string
 *                     role:
 *                       type: string
 *                 tokens:
 *                   type: object
 *                   properties:
 *                     accessToken:
 *                       type: string
 *                     expiresIn:
 *                       type: number
 *       400:
 *         description: Authentication failed
 *       500:
 *         description: Server error
 */
router.get('/callback', authController.handleCallback);

/**
 * @swagger
 * /auth/refresh:
 *   post:
 *     summary: Refresh access token using refresh token
 *     tags: [Authentication]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken:
 *                 type: string
 *                 description: Refresh token (optional if sent via cookie)
 *     responses:
 *       200:
 *         description: New access token generated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accessToken:
 *                   type: string
 *                 expiresIn:
 *                   type: number
 *       401:
 *         description: Invalid or expired refresh token
 */
router.post('/refresh', authController.refreshAccessToken);

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Logout user and invalidate tokens
 *     tags: [Authentication]
 *     responses:
 *       200:
 *         description: Logout successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 message:
 *                   type: string
 *       500:
 *         description: Server error
 */
router.post('/logout', authController.logout);

/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: Get current authenticated user information
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     name:
 *                       type: string
 *                     email:
 *                       type: string
 *                     application:
 *                       type: string
 *                     role:
 *                       type: string
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 */
router.get('/me', enhancedVerifyJWT, authController.getCurrentUser);

// User approval routes (public - no JWT required for email links)
/**
 * @swagger
 * /auth/approve:
 *   get:
 *     summary: Approve user account via email token
 *     tags: [Authentication]
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Approval token from email
 *     responses:
 *       200:
 *         description: User approved successfully
 *       400:
 *         description: Invalid or missing token
 *       500:
 *         description: Server error
 */
router.get('/approve', approvalController.approveUser);

/**
 * @swagger
 * /auth/deny:
 *   get:
 *     summary: Deny user account via email token
 *     tags: [Authentication]
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Denial token from email
 *     responses:
 *       200:
 *         description: User denied successfully
 *       400:
 *         description: Invalid or missing token
 *       500:
 *         description: Server error
 */
router.get('/deny', approvalController.denyUser);

/**
 * @swagger
 * /auth/pending-users:
 *   get:
 *     summary: Get list of pending users (admin only)
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of pending users
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/pending-users', enhancedVerifyJWT, approvalController.getPendingUsers);

/**
 * @swagger
 * /auth/manual-approve:
 *   post:
 *     summary: Manually approve user (admin only)
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userId:
 *                 type: string
 *     responses:
 *       200:
 *         description: User approved successfully
 *       400:
 *         description: Missing user ID
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
router.post('/manual-approve', enhancedVerifyJWT, approvalController.manuallyApproveUser);

/**
 * @swagger
 * /auth/manual-deny:
 *   post:
 *     summary: Manually deny user (admin only)
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userId:
 *                 type: string
 *     responses:
 *       200:
 *         description: User denied successfully
 *       400:
 *         description: Missing user ID
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
router.post('/manual-deny', enhancedVerifyJWT, approvalController.manuallyDenyUser);

/**
 * @swagger
 * /auth/test-email:
 *   post:
 *     summary: Test email configuration
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               name:
 *                 type: string
 *     responses:
 *       200:
 *         description: Email sent successfully
 *       400:
 *         description: Email configuration error
 *       500:
 *         description: Server error
 */
router.post('/test-email', approvalController.testEmail);

export default router;
