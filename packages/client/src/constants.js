export const DEFAULT_COOKIE_NAME = 'accesstoken';

export const DEFAULT_REMEMBER_ME_MAX_AGE = 7 * 24 * 3600;
export const DEFAULT_MAX_AGE = 24 * 3600;

export const EXPIRED_MSG_PATTERNS = [
  /token expired/i,
  /invalid authentication/i,
  /please verify info/i,
  /please login or register/i,
];

export const JWT_PREFIX_PATTERN = /^JWT\s+/;
