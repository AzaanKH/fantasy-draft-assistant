import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkDraftEffectFree } from './check-draft-effect.mjs';

const temporaryRoots = [];
afterEach(async () => { await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function emitted(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'draft-effect-'));
  temporaryRoots.push(root);
  for (const [file, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), text);
  }
  return { root, entry: 'draft/index.js' };
}

describe('built shared/draft Effect-free import closure', () => {
  it('accepts a plain transitive graph with static/dynamic imports, reexports and cycles', async () => {
    const fixture = await emitted({
      'draft/index.js': "export * from '../pure.js'; import('./lazy.js');",
      'pure.js': "import './draft/index.js'; export const value = 1;",
      'draft/lazy.js': "import 'node:util'; export const value = 2;",
    });
    expect(checkDraftEffectFree(fixture)).toBe(3);
  });
  it.each(["import 'effect';", "export * from 'effect/Schema';", "import('@effect/platform');",
    "require('npm:effect@4');", "import '/repo/node_modules/.pnpm/effect@4/node_modules/effect/Effect.js';"])(
    'rejects dormant transitive Effect dependency %s', async dependency => {
      const fixture = await emitted({ 'draft/index.js': "export * from '../middle.js';", 'middle.js': "export const lazy = () => import('./leaf.js');", 'leaf.js': dependency });
      expect(() => checkDraftEffectFree(fixture)).toThrow('draft/index.js -> middle.js -> leaf.js');
      expect(() => checkDraftEffectFree(fixture)).toThrow('move Effect decoding to the I/O boundary');
    });
  it.each(["import(name);", "import 'unknown-package';", "export * from './missing.js';"])(
    'fails closed when it cannot establish the emitted graph: %s', async source => {
      const fixture = await emitted({ 'draft/index.js': source });
      expect(() => checkDraftEffectFree(fixture)).toThrow();
    });
  it.each(['node:module', 'module'])('rejects dormant createRequire through %s', async specifier => {
    const fixture = await emitted({ 'draft/index.js': `import { createRequire } from '${specifier}';
      export const dormant = () => createRequire(import.meta.url)('effect');` });
    expect(() => checkDraftEffectFree(fixture)).toThrow('module loader capability');
  });
  it.each([
    "import * as loader from 'node:module'; export const dormant = () => loader.createRequire(import.meta.url)('effect');",
    "export { createRequire as loader } from 'module';",
    "export const dormant = async () => (await import('node:module')).createRequire(import.meta.url)('effect');",
    "const { createRequire } = require('module'); export const dormant = () => createRequire(__filename)('effect');",
    "export const dormant = () => process.getBuiltinModule('module').createRequire(import.meta.url)('effect');",
    "export const dormant = () => process.getBuiltinModule('node:module').createRequire(import.meta.url)('effect');",
    "const loader = process['getBuiltinModule']; export const dormant = () => loader('module').createRequire(import.meta.url)('effect');",
    "const { getBuiltinModule: loader } = process; export const dormant = () => loader('module').createRequire(import.meta.url)('effect');",
    "const { ['getBuiltinModule']: loader } = process; export const dormant = () => loader('module').createRequire(import.meta.url)('effect');",
    "import { getBuiltinModule as loader } from 'node:process'; export const dormant = () => loader('module').createRequire(import.meta.url)('effect');",
  ])('rejects module loader capability in a dormant transitive module %#', async source => {
    const fixture = await emitted({ 'draft/index.js': "export * from '../loader.js';", 'loader.js': source });
    expect(() => checkDraftEffectFree(fixture)).toThrow('module loader capability');
    expect(() => checkDraftEffectFree(fixture)).toThrow('loader.js');
  });
  it('requires the emitted draft root', async () => {
    expect(() => checkDraftEffectFree({ root: '/missing-emitted-package' })).toThrow('Missing or unreadable emitted draft module');
  });
});
