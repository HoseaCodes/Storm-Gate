import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './server.js';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  document.cookie.split('; ').forEach((c) => {
    const name = c.split('=')[0];
    if (name) document.cookie = `${name}=; path=/; max-age=0`;
  });
});
afterAll(() => server.close());
