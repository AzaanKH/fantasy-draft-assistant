import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('../web-app/src', import.meta.url)) } },
  test: { include: ['src/**/*.test.ts'] },
});
