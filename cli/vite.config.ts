import { defineConfig } from 'vite';
import { sourceCondition } from '../source-condition.js';

export default defineConfig({
  ...sourceCondition,
  build: {
    target: 'node22',
    minify: false,
    lib: { entry: 'src/main.ts', formats: ['es'], fileName: () => 'draft.js' },
    rollupOptions: { external: /^node:/ },
  },
});
