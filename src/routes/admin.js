
import express from 'express';
import auth from '../utils/auth.js';
import isAdmin from '../utils/authAdmin.js';
const router = express.Router();
import { nodecache } from '../utils/cache.js';
import adminCtrl from '../controllers/admin.js';

/**
 * @swagger
 * tags:
 *   name: Admin
 *   description: Admin user management
 */

/**
 * @swagger
 * /api/admin:
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
 *                   example: "Not allowed: You don't have enough permission to perform this action"
 *       401:
 *         description: Unauthorized - Permission denied
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Not allowed: You don't have enough permission to perform this action"
 *       500:
 *         description: Internal Server Error
 */
router.get("/", nodecache, adminCtrl.getAllUsers);


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
router.get("/:id", nodecache, adminCtrl.getUserById);

export default router;
