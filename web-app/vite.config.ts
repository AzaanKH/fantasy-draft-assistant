/// <reference types="vitest" />
import { readFile } from 'node:fs/promises';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { BROWSER_DATA_FILES } from '../scripts/src/browser-data';

const repoRoot = path.resolve(__dirname, '..');
const browserDataPaths = new Set<string>(BROWSER_DATA_FILES);

function browserDataPlugins(): Plugin[] {
  return [{
    name: 'browser-data-dev-server',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          next();
          return;
        }

        const pathname = new URL(
          request.url ?? '/',
          'http://vite.local'
        ).pathname.slice(1);
        if (!browserDataPaths.has(pathname)) {
          next();
          return;
        }

        void readFile(path.join(repoRoot, pathname)).then((content) => {
          response.statusCode = 200;
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.setHeader('Cache-Control', 'no-store');
          response.end(request.method === 'HEAD' ? undefined : content);
        }).catch(() => {
          response.statusCode = 404;
          response.end('Not found');
        });
      });
    },
  }, {
    name: 'browser-data-build',
    apply: 'build',
    async buildStart() {
      for (const fileName of BROWSER_DATA_FILES) {
        this.emitFile({
          type: 'asset',
          fileName,
          source: await readFile(path.join(repoRoot, fileName)),
        });
      }
    },
  }];
}

export default defineConfig({
  publicDir: false,
  plugins: [...browserDataPlugins(), react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        headers: {
          Origin: 'http://localhost:3000',
        },
      },
    },
  },
  build: {
    target: 'esnext',
    sourcemap: true,
  },
});
