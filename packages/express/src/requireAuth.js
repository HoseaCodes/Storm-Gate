import jwt from 'jsonwebtoken';
import { extractToken } from './extractToken.js';

export function createRequireAuth({ secret, algorithms = ['HS256'] } = {}) {
  if (!secret) {
    throw new Error('createRequireAuth requires a "secret" option');
  }

  return function requireAuth(req, res, next) {
    const token = extractToken(req.headers?.authorization || req.header?.('Authorization'));
    if (!token) {
      return res.status(401).json({ msg: 'Missing authentication token' });
    }

    jwt.verify(token, secret, { algorithms }, (err, decoded) => {
      if (err) {
        const msg = err.name === 'TokenExpiredError'
          ? 'Token expired'
          : 'Invalid authentication token';
        return res.status(401).json({ msg, code: err.name });
      }
      req.user = decoded;
      next();
    });
  };
}
