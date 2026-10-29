import { validateClassicContentScript, validateExtensionPageBundle } from './config/ui-bundle-guard';
import { decodeExtensionManifest } from './config/manifest-decoder';
import { build, defineConfig, type BuildOptions, type Plugin } from 'vite';
import { sourceCondition } from '../source-condition.js';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { localDevPorts } from '../shared/src/local-dev';

const ports = localDevPorts(process.env);
const define = { __DRAFT_LOCAL_PORTS__: JSON.stringify(ports) };
const output = { entryFileNames: '[name].js', chunkFileNames: '[name].js', assetFileNames: '[name].[ext]' };
const classicContentScripts = {
  content: resolve(__dirname, 'src/content/sleeper-detector.ts'),
  'espn-page': resolve(__dirname, 'src/content/espn-page-bridge.ts'),
};

function copyStaticFiles(): Plugin {
  return {
    name: 'copy-static-files',
    closeBundle() {
      const distDir = resolve(__dirname, 'dist');

      if (!existsSync(distDir)) {
        mkdirSync(distDir, { recursive: true });
      }

      const manifest = decodeExtensionManifest(JSON.parse(readFileSync(resolve(__dirname, 'public/manifest.json'), 'utf8')));
      const hostPermissions = [
        ...manifest.host_permissions.filter((origin: string) => !origin.startsWith('http://localhost:') && !origin.startsWith('http://127.0.0.1:')),
        ...[ports.webPort, ports.apiPort].flatMap(port =>
          ['localhost', '127.0.0.1'].map(host => `http://${host}:${String(port)}/*`)),
      ];
      const emittedManifest = {
        ...manifest, host_permissions: hostPermissions,
        content_security_policy: {
          ...manifest.content_security_policy,
          extension_pages: `script-src 'self'; object-src 'self'; frame-src http://localhost:${String(ports.webPort)} http://127.0.0.1:${String(ports.webPort)}`,
        },
      };
      writeFileSync(resolve(distDir, 'manifest.json'), JSON.stringify(emittedManifest, null, 2) + '\n');

      copyFileSync(
        resolve(__dirname, 'src/sidepanel/sidepanel.html'),
        resolve(distDir, 'sidepanel.html')
      );

      copyFileSync(
        resolve(__dirname, 'src/sidepanel/sidepanel.css'),
        resolve(distDir, 'sidepanel.css')
      );

      for (const file of ['options.html', 'options.css']) {
        copyFileSync(resolve(__dirname, 'src/options', file), resolve(distDir, file));
      }
      const iconSizes = ['16', '32', '48', '128'];
      for (const size of iconSizes) {
        const iconPath = resolve(__dirname, `public/icon${size}.png`);
        if (existsSync(iconPath)) {
          copyFileSync(iconPath, resolve(distDir, `icon${size}.png`));
        }
      }

      console.log('Static files copied to dist/');
    },
  };
}

function validateExtensionPages(): Plugin {
  return {
    name: 'validate-extension-pages',
    generateBundle(_options, bundle) {
      validateExtensionPageBundle(bundle);
    },
  };
}

function buildClassicContentScripts(): Plugin {
  let watch: BuildOptions['watch'] = null;
  let started = false;
  return {
    name: 'build-classic-content-scripts',
    apply: 'build',
    configResolved(config) {
      watch = config.build.watch;
    },
    async closeBundle() {
      if (started && watch) return;
      started = true;
      for (const [name, entry] of Object.entries(classicContentScripts)) {
        await build({
          ...sourceCondition,
          root: __dirname,
          configFile: false,
          define,
          logLevel: 'warn',
          plugins: [{
            name: 'validate-classic-content-script',
            generateBundle(_options, bundle) {
              validateClassicContentScript(bundle, `${name}.js`);
            },
          }],
          build: {
            outDir: resolve(__dirname, 'dist'),
            emptyOutDir: false,
            minify: false,
            sourcemap: true,
            watch,
            rollupOptions: { input: { [name]: entry }, output: { ...output, inlineDynamicImports: true } },
          },
        });
      }
    },
  };
}

export default defineConfig({
  ...sourceCondition,
  define,
  plugins: [validateExtensionPages(), copyStaticFiles(), buildClassicContentScripts()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background/service-worker.ts'),
        sidepanel: resolve(__dirname, 'src/sidepanel/sidepanel.ts'),
        options: resolve(__dirname, 'src/options/options.ts'),
      },
      output,
    },
    // Don't minify for easier debugging during development
    minify: false,
    sourcemap: true,
  },
});
