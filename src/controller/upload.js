import fs from 'fs';
import dotenv from 'dotenv';
import cloudinary from 'cloudinary';
import Logger from '../utils/logger.js';
import {cache} from '../utils/cache.js';
const logger = new Logger('articles')

dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUND_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_API_SECRET
});

const removeTmp = (path) => {
  fs.unlink(path, err => {
      if (err) throw err;
  });
}

async function getAllUploads(req, res) {
  try {

    cloudinary.v2.search.expression(
      'folder:HoseaCodes/*' // add your folder
      ).sort_by('created_at','desc').max_results(30).execute().then(result=> {

        res.cookie('cloudinary-cache', result.total_count + "upload", {
          maxAge: 1000 * 60 * 60, // would expire after an hour
          httpOnly: true, // The cookie only accessible by the web server
       })

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

      return res.status(500).json({ msg: err.message })
  }
}

async function uploadImage(req, res) {
  try {
      if (!req.files || Object.keys(req.files).length === 0) return res.status(400).send({ msg: "No files were uploaded." })

      const file = req.files.file;
      if (file.size > 1024 * 1024) {
          removeTmp(file.tempFilePath)
          return res.status(400).json({ msg: "File size too large" })
      }

      if (file.mimetype !== 'image/jpeg' && file.mimetype !== 'image/png') {
          removeTmp(file.tempFilePath)
          return res.status(400).json({ msg: "File format is incorrect" })
      }

      res.clearCookie('cloudinary-cache');

      cloudinary.v2.uploader.upload(file.tempFilePath, { folder: "HoseaCodes" }, async (err, result) => {
          if (err) throw err;

          removeTmp(file.tempFilePath)

          res.json({ result })
      })

  } catch (err) {
      return res.status(500).json({ msg: err.message })
  }
}

async function destoryImage(req, res) {
  try {

    const { public_id } = req.body;

    if (!public_id) return res.status(400).json({ msg: 'No images Selected' });

    res.clearCookie('cloudinary-cache');

     await cloudinary.v2.uploader.destroy(public_id, async (err, result) => {
          if (err) throw err;

          res.json({ msg: 'Deleted Image' })
      });

  } catch (err) {
      return res.status(500).json({ msg: err.message })
  }

}


export {
  uploadImage,
  destoryImage,
  getAllUploads
  };
