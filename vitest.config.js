import { defineConfig } from 'vitest/config';

// Service-level tests only. The workspace packages carry their own vitest
// configs and run via `npm run test:packages`, so they are excluded here to
// keep the two suites independently runnable.
export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    exclude: ['**/node_modules/**', 'packages/**'],
    environment: 'node',
  },
});
