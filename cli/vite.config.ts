import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { sourceCondition } from '../source-condition.js';

export default defineConfig({
  ...sourceCondition,
  resolve: { ...sourceCondition.resolve, alias: { '@': fileURLToPath(new URL('../web-app/src', import.meta.url)) } },
  build: {
    target: 'node22',
    minify: false,
    lib: { entry: 'src/main.ts', formats: ['es'], fileName: () => 'draft.js' },
    rollupOptions: { external: /^node:/ },
  },
});
