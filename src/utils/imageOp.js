import imagemin from 'imagemin';
import imageminJpegtran from 'imagemin-jpegtran';
import imageminPngquant from 'imagemin-pngquant';

const imageOp = (async () => {
  try {
    const files = await imagemin(['images/*.{jpg,png}'], {
      destination: 'build/static/media',
      plugins: [
        imageminJpegtran(),
        imageminPngquant({
          quality: [0.6, 0.8]
        })
      ]
    });
  } catch (err) {
    logger.error(err);
  }
})

export { imageOp };
