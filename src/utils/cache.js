import NodeCache from 'node-cache';
import Logger from '../utils/logger.js';

const logger = new Logger('cache')

const cache = new NodeCache({ stdTTL: 15 });

const nodecache = (req, res, next) =>{
  try {

    const { id } = req.params;
    if (cache.has(id)) {
      logger.info(`Cache hit - ${id}`);
      return res.status(200).json(cache.get(id));
    }

    if (cache.has(req.cookies['cloudinary-cache'])) {
      logger.info(`Cache hit - ${req.cookies['cloudinary-cache']}`);
      return res.status(200).json(cache.get(req.cookies['cloudinary-cache']));
    }

    if (cache.has(req.cookies['users-cache'])) {
      logger.info(`Cache hit - ${req.cookies['users-cache']}`);
      return res.status(200).json(cache.get(req.cookies['users-cache']));
    }
    if (cache.has(req.cookies['user-cache'])) {
      logger.info(`Cache hit - ${req.cookies['user-cache']}`);
      return res.status(200).json(cache.get(req.cookies['user-cache']));
    }
    if (cache.has(req.cookies['history-cache'])) {
      logger.info(`Cache hit - ${req.cookies['history-cache']}`);
      return res.status(200).json(cache.get(req.cookies['history-cache']));
    }
      logger.info(`Cache missed - ${id}`);
      next();

  } catch (err) {
    logger.error(`Cache error - ${err}`);
    throw new Error(err)
  }
}

export {nodecache, cache};
