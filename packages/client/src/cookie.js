import { DEFAULT_COOKIE_NAME, JWT_PREFIX_PATTERN } from './constants.js';

function assertBrowser() {
  if (typeof document === 'undefined') {
    throw new Error(
      '@storm-gate/client requires a browser environment (document.cookie). ' +
        'For server-side rendering, guard calls with `typeof window !== "undefined"`.',
    );
  }
}

export function createCookieStore({ cookieName = DEFAULT_COOKIE_NAME } = {}) {
  return {
    read() {
      assertBrowser();
      const raw = document.cookie
        .split('; ')
        .find((row) => row.startsWith(`${cookieName}=`));
      if (!raw) return null;
      const value = decodeURIComponent(raw.slice(cookieName.length + 1));
      return value.replace(JWT_PREFIX_PATTERN, '') || null;
    },
    write(token, { maxAge } = {}) {
      assertBrowser();
      const cleaned = String(token).replace(JWT_PREFIX_PATTERN, '');
      const parts = [
        `${cookieName}=${encodeURIComponent(cleaned)}`,
        'path=/',
        'SameSite=Lax',
      ];
      if (typeof maxAge === 'number') parts.push(`max-age=${Math.floor(maxAge)}`);
      document.cookie = parts.join('; ');
    },
    clear() {
      assertBrowser();
      document.cookie = `${cookieName}=; path=/; max-age=0; SameSite=Lax`;
    },
  };
}
