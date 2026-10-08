/// <reference types="vitest" />
import { localDevPorts } from '../shared/src/local-dev';
import { readFile } from 'node:fs/promises';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { BROWSER_DATA_FILES, DEMO_BROWSER_DATA_FILES } from '../scripts/src/browser-data';
import { localApiSecurity } from '../server/src/vite-security';

const { webPort, apiOrigin } = localDevPorts(process.env);

const repoRoot = path.resolve(__dirname, '..');
const browserDataPaths = new Set<string>(BROWSER_DATA_FILES);

// BROWSER_DATA_SOURCE=demo serves demo-data/ (including its recommendation
// policy) without changing data/. The dev server falls back to data/ for files
// the demo does not ship; a demo build emits only demo-data/ files and fails if
// one it needs is missing, so local data never reaches a published demo.
const browserDataSource = process.env['BROWSER_DATA_SOURCE'] ?? 'local';
if (browserDataSource !== 'local' && browserDataSource !== 'demo') {
  throw new Error(`BROWSER_DATA_SOURCE must be "local" or "demo"; got "${browserDataSource}".`);
}
// VITE_DEMO_MODE=true also switches the app to its static demo runtime.
if (process.env['VITE_DEMO_MODE'] === 'true' && browserDataSource !== 'demo') {
  throw new Error('VITE_DEMO_MODE=true requires BROWSER_DATA_SOURCE=demo.');
}

function demoDataPath(fileName: string): string {
  return path.join(repoRoot, 'demo-data', path.relative('data', fileName));
}

async function readBrowserData(fileName: string): Promise<Buffer> {
  if (browserDataSource === 'demo') {
    try {
      return await readFile(demoDataPath(fileName));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return readFile(path.join(repoRoot, fileName));
}

async function readDemoBuildData(fileName: string): Promise<Buffer> {
  try {
    return await readFile(demoDataPath(fileName));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    throw new Error(
      `Demo build is missing demo-data/${path.relative('data', fileName)}. Run \`pnpm data:demo:build\` to regenerate demo-data/.`
    );
  }
}

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

        void readBrowserData(pathname).then((content) => {
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
      const demoBuild = browserDataSource === 'demo';
      for (const fileName of demoBuild ? DEMO_BROWSER_DATA_FILES : BROWSER_DATA_FILES) {
        this.emitFile({
          type: 'asset',
          fileName,
          source: await (demoBuild ? readDemoBuildData(fileName) : readBrowserData(fileName)),
        });
      }
    },
  }];
}

export default defineConfig({
  publicDir: false,
  plugins: [localApiSecurity(), ...browserDataPlugins(), react(), tailwindcss()],
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
    host: '127.0.0.1',
    port: webPort,
    strictPort: true,
    cors: false,
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.local/**'] },
    proxy: {
      '/api': {
        target: apiOrigin,
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'esnext',
    sourcemap: true,
  },
});
