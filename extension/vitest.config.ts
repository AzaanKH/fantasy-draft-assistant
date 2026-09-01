import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@fantasy-draft/shared': resolve(__dirname, '../shared/src'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    restoreMocks: true,
  },
});
