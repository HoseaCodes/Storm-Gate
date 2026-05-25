import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.js'],
    setupFiles: ['test/setup.js'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
    },
  },
});
