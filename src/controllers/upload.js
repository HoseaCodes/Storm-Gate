import fs from 'fs';
import dotenv from 'dotenv';
import cloudinary from '../config/cloudinary.js';
import Image from '../models/image.js';
import Logger from '../utils/logger-lambda.js';
import { cache } from '../utils/cache.js';

const logger = new Logger('articles');
dotenv.config();

const removeTmp = (path) => {
  fs.unlink(path, err => {
      if (err) throw err;
  });
};

async function getAllUploads(req, res) {
  try {
    cloudinary.v2.search.expression(
      'folder:HoseaCodes/*' // add your folder
    )
    .sort_by('created_at', 'desc')
    .max_results(30)
    .execute()
    .then(result => {
      res.cookie('cloudinary-cache', result.total_count + "upload", {
        maxAge: 1000 * 60 * 60, // Expires after an hour
        httpOnly: true, // The cookie is only accessible by the web server
      });

      cache.set(result.total_count + "upload", {
        status: 'success',
        location: 'cache',
        result: result,
      });

      res.json({
        status: 'success',
        location: 'main',
        result: result,
      });
    });
  } catch (err) {
    logger.error(err);
    return res.status(500).json({ msg: err.message });
  }
}

async function getAllImages(req, res) {
  try {
    const images = await Image.find({ userId: req.user.id });
    res.status(200).json(images);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function deleteImage(req, res) {
  try {
    const image = await Image.findById(req.params.id);
    if (!image) return res.status(404).json({ message: 'Image not found' });

    await cloudinary.uploader.destroy(image.public_id);
    await image.remove();
    res.status(200).json({ message: 'Image deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function uploadImage(req, res) {
  try {
    if (!req.files || Object.keys(req.files).length === 0) return res.status(400).send({ msg: "No files were uploaded." });

    const file = req.files.file;
    if (file.size > 1024 * 1024) { // Limit file size to 1MB
      removeTmp(file.tempFilePath);
      return res.status(400).json({ msg: "File size too large" });
    }

    if (file.mimetype !== 'image/jpeg' && file.mimetype !== 'image/png') {
      removeTmp(file.tempFilePath);
      return res.status(400).json({ msg: "File format is incorrect" });
    }

    res.clearCookie('cloudinary-cache');

    const result = await cloudinary.v2.uploader.upload(file.tempFilePath, { folder: "HoseaCodes" });
    removeTmp(file.tempFilePath);
    // res.json({ result })
    const newImage = new Image({
      userId: req.user.id,
      url: result.secure_url,
      public_id: result.public_id,
    });

    await newImage.save();
    res.status(201).json({ message: 'File uploaded successfully', data: newImage });
  } catch (err) {
    return res.status(500).json({ msg: err.message });
  }
}

async function destoryImage(req, res) {
  try {
    const { public_id } = req.body;
    if (!public_id) return res.status(400).json({ msg: 'No images selected' });

    res.clearCookie('cloudinary-cache');

    await cloudinary.v2.uploader.destroy(public_id, (err, result) => {
      if (err) throw err;
      res.json({ msg: 'Deleted Image' });
    });
  } catch (err) {
    return res.status(500).json({ msg: err.message });
  }
}

export {
  uploadImage,
  destoryImage,
  getAllUploads,
  getAllImages,
  deleteImage
};
