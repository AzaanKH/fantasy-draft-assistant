import { localDevPorts } from '../shared/src/local-dev';
import { readFile } from 'node:fs/promises';
import { defineConfig, type Plugin } from 'vite';
import { sourceCondition } from '../source-condition.js';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { browserDataFiles } from '../shared/src/catalog/manifest';

import { localApiSecurity } from '../server/src/vite-security';
import { noNodeInBrowserBundle } from '../scripts/no-node-in-browser-bundle';
import { browserDataCandidates, resolveDataSource, type BrowserDataPhase } from './src/lib/browser-data-source';

const BROWSER_DATA_FILES = browserDataFiles('local');
const DEMO_BROWSER_DATA_FILES = browserDataFiles('demo');

const { webPort, apiOrigin, webOrigin } = localDevPorts(process.env);

const repoRoot = path.resolve(__dirname, '..');
const browserDataPaths = new Set<string>(BROWSER_DATA_FILES);

const browserDataSource = resolveDataSource(process.env);

async function readBrowserData(fileName: string, phase: BrowserDataPhase): Promise<Buffer> {
  const candidates = browserDataCandidates(browserDataSource, phase, fileName);
  for (const [index, candidate] of candidates.entries()) {
    try {
      return await readFile(path.join(repoRoot, candidate));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (index < candidates.length - 1) continue;
      if (phase === 'build' && browserDataSource === 'demo') {
        throw new Error(`Demo build is missing ${candidate}. Run \`pnpm data:demo:build\` to regenerate demo-data/.`);
      }
      throw error;
    }
  }
  throw new Error(`No browser data candidates for ${fileName}.`);
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

        void readBrowserData(pathname, 'serve').then((content) => {
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
      for (const fileName of browserDataSource === 'demo' ? DEMO_BROWSER_DATA_FILES : BROWSER_DATA_FILES) {
        this.emitFile({ type: 'asset', fileName, source: await readBrowserData(fileName, 'build') });
      }
    },
  }];
}

export default defineConfig({
  ...sourceCondition,
  publicDir: false,
  define: { 'import.meta.env.VITE_CANONICAL_WEB_ORIGIN': JSON.stringify(webOrigin) },
  plugins: [noNodeInBrowserBundle(), localApiSecurity(), ...browserDataPlugins(), react(), tailwindcss()],
  resolve: {
    ...sourceCondition.resolve,
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
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
