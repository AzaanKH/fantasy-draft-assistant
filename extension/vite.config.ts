import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { localDevPorts } from '../shared/src/local-dev';

const ports = localDevPorts(process.env);

interface ExtensionManifest {
  host_permissions: string[];
  content_security_policy: { extension_pages: string };
}

function isExtensionManifest(value: unknown): value is ExtensionManifest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const manifest = value as Record<string, unknown>;
  const policy = manifest.content_security_policy;
  return Array.isArray(manifest.host_permissions) &&
    manifest.host_permissions.every((origin: unknown) => typeof origin === 'string') &&
    typeof policy === 'object' && policy !== null && !Array.isArray(policy) &&
    typeof (policy as Record<string, unknown>).extension_pages === 'string';
}

// Plugin to copy static files after build
function copyStaticFiles(): Plugin {
  return {
    name: 'copy-static-files',
    closeBundle() {
      const distDir = resolve(__dirname, 'dist');

      // Ensure dist directory exists
      if (!existsSync(distDir)) {
        mkdirSync(distDir, { recursive: true });
      }

      // Copy manifest.json
      const manifest: unknown = JSON.parse(readFileSync(resolve(__dirname, 'public/manifest.json'), 'utf8'));
      if (!isExtensionManifest(manifest)) throw new Error('Invalid extension manifest permissions or content security policy');
      manifest.host_permissions = [
        ...manifest.host_permissions.filter((origin: string) => !origin.startsWith('http://localhost:') && !origin.startsWith('http://127.0.0.1:')),
        ...[ports.webPort, ports.apiPort].flatMap(port =>
          ['localhost', '127.0.0.1'].map(host => `http://${host}:${String(port)}/*`)),
      ];
      manifest.content_security_policy.extension_pages =
        `script-src 'self'; object-src 'self'; frame-src http://localhost:${String(ports.webPort)} http://127.0.0.1:${String(ports.webPort)}`;
      writeFileSync(resolve(distDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

      // Copy sidepanel.html
      copyFileSync(
        resolve(__dirname, 'src/sidepanel/sidepanel.html'),
        resolve(distDir, 'sidepanel.html')
      );

      copyFileSync(
        resolve(__dirname, 'src/sidepanel/sidepanel.css'),
        resolve(distDir, 'sidepanel.css')
      );

      // Copy icons if they exist
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

function validateClassicContentScripts(): Plugin {
  return {
    name: 'validate-classic-content-scripts',
    generateBundle(_options, bundle) {
      for (const fileName of ['content.js', 'espn-page.js']) {
        const output = bundle[fileName] as {
          type?: string;
          imports?: readonly string[];
          dynamicImports?: readonly string[];
        } | undefined;
        if (
          output?.type === 'chunk' &&
          ((output.imports?.length ?? 0) > 0 ||
            (output.dynamicImports?.length ?? 0) > 0)
        ) {
          throw new Error(
            `${fileName} must be self-contained because Chrome content scripts are not ES modules`
          );
        }
      }
    },
  };
}

export default defineConfig({
  define: { __DRAFT_LOCAL_PORTS__: JSON.stringify(ports) },
  plugins: [validateClassicContentScripts(), copyStaticFiles()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background/service-worker.ts'),
        content: resolve(__dirname, 'src/content/sleeper-detector.ts'),
        'espn-page': resolve(__dirname, 'src/content/espn-page-bridge.ts'),
        sidepanel: resolve(__dirname, 'src/sidepanel/sidepanel.ts'),
        options: resolve(__dirname, 'src/options/options.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
      },
    },
    // Don't minify for easier debugging during development
    minify: false,
    sourcemap: true,
  },
  resolve: {
    alias: {
      '@fantasy-draft/shared': resolve(__dirname, '../shared/src'),
    },
  },
});
