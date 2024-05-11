import express from 'express';
import {
  uploadImage,
  destoryImage,
  getAllUploads
} from '../controllers/upload.js';
import {nodecache} from '../utils/cache.js';

const router = express.Router();

//image upload
router.post("/allImages", nodecache, getAllUploads);

//image upload
router.post("/upload", uploadImage);

//image delete
router.post("/destory", destoryImage);

export default router;
