import express from 'express';
import {
  uploadImage,
  destoryImage,
  getAllUploads,
  getAllImages,
  deleteImage
} from '../controllers/upload.js';
import {nodecache} from '../utils/cache.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Upload
 *   description: Image management
 */

/**
 * @description Get all uploads from Cloudinary in the specified folder.
 * @route GET /uploads
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {JSON} - Returns a list of images stored in Cloudinary
 */
router.post("/allImages", nodecache, getAllUploads);

/**
 * @description Get all images uploaded by the authenticated user.
 * @route GET /images
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {JSON} - Returns a list of images
 */
router.post("/images", getAllImages);

/**
 * @description Upload an image to Cloudinary.
 * @route POST /upload
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {JSON} - Returns the uploaded image information
 */
router.post("/upload", uploadImage);

/**
 * @description Destroy an image from Cloudinary by public_id.
 * @route DELETE /destroy
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {JSON} - Returns a success message after image deletion
 */
router.post("/destory", destoryImage);

/**
 * @description Delete an image by its ID.
 * @route DELETE /images/:id
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {JSON} - Returns a success message after deletion
 */
router.post("/image/:id", deleteImage);

export default router;
