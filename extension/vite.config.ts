import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync } from 'fs';

// Plugin to copy static files after build
function copyStaticFiles() {
  return {
    name: 'copy-static-files',
    closeBundle() {
      const distDir = resolve(__dirname, 'dist');

      // Ensure dist directory exists
      if (!existsSync(distDir)) {
        mkdirSync(distDir, { recursive: true });
      }

      // Copy manifest.json
      copyFileSync(
        resolve(__dirname, 'public/manifest.json'),
        resolve(distDir, 'manifest.json')
      );

      // Copy sidepanel.html
      copyFileSync(
        resolve(__dirname, 'src/sidepanel/sidepanel.html'),
        resolve(distDir, 'sidepanel.html')
      );

      // Copy icons if they exist
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

export default defineConfig({
  plugins: [copyStaticFiles()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background/service-worker.ts'),
        content: resolve(__dirname, 'src/content/sleeper-detector.ts'),
        sidepanel: resolve(__dirname, 'src/sidepanel/sidepanel.ts'),
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
