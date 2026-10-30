import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const nodeOnlyDirectories = ['server', 'shared/src/node', 'shared/dist/node'].map(directory => canonicalPath(path.join(repoRoot, directory)));

function canonicalPath(file: string): string {
  try {
    return realpathSync.native(file);
  } catch {
    const parent = path.dirname(file);
    return parent === file ? file : path.join(canonicalPath(parent), path.basename(file));
  }
}

function isInside(file: string, directory: string): boolean {
  const relative = path.relative(directory, file);
  return relative === '' || (relative.split(path.sep)[0] !== '..' && !path.isAbsolute(relative));
}

function nodeOnlyFile(id: string): string | undefined {
  const file = id.replace(/^\0/, '').replace(/[?#].*$/s, '').replace(/^\/@fs\//, '/');
  if (!path.isAbsolute(file)) return undefined;
  const canonical = canonicalPath(file);
  return nodeOnlyDirectories.some(directory => isInside(canonical, directory)) ? canonical : undefined;
}

function* filesUnder(directory: string): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') yield* filesUnder(file);
    else if (entry.isFile()) yield file;
  }
}

function inlinedDataFingerprints(): Map<string, string> {
  const fingerprints = new Map<string, string>();
  for (const directory of nodeOnlyDirectories.filter(directory => existsSync(directory))) {
    for (const file of filesUnder(directory)) {
      const content = readFileSync(file);
      if (content.length) fingerprints.set(`base64,${content.toString('base64')}`, file);
    }
  }
  return fingerprints;
}

function rejection(file: string, output?: string): string {
  return `${output ? `${output} inlines ` : ''}${path.relative(repoRoot, file)}: browser bundles must not include server/ or shared/src/node modules or assets. Keep Node-only code in Node entry points and Vite configuration.`;
}

export function noNodeInBrowserBundle(): Plugin {
  let root = repoRoot;
  return {
    name: 'no-node-in-browser-bundle',
    enforce: 'pre',
    config(config) {
      const workerPlugins = config.worker?.plugins;
      config.worker = { ...config.worker, plugins: () => [noNodeInBrowserBundle(), ...(workerPlugins?.() ?? [])] };
    },
    configResolved(config) {
      root = config.root;
    },
    load(id) {
      const file = nodeOnlyFile(id);
      if (file) this.error(rejection(file));
    },
    generateBundle(_options, bundle) {
      const fingerprints = inlinedDataFingerprints();
      for (const id of this.getModuleIds()) {
        const file = nodeOnlyFile(id);
        if (file) this.error(rejection(file));
      }
      for (const output of Object.values(bundle)) {
        for (const name of output.type === 'asset' ? output.originalFileNames : []) {
          const file = nodeOnlyFile(path.resolve(root, name));
          if (file) this.error(rejection(file));
        }
        const text = output.type === 'chunk' ? output.code
          : typeof output.source === 'string' ? output.source : Buffer.from(output.source).toString('latin1');
        for (const [fingerprint, file] of fingerprints) {
          if (text.includes(fingerprint)) this.error(rejection(file, output.fileName));
        }
      }
    },
  };
}
