import { describe, expect, it } from 'vitest';
import { validateUiEntryBundle } from '../../config/ui-bundle-guard';

const failure = 'decode in the background; UI entries use plain predicates';
const effectModule = '/repo/node_modules/.pnpm/effect@4.0.0/node_modules/effect/src/Schema.ts';
function chunk(modules: readonly string[] = [], imports: readonly string[] = [], dynamicImports: readonly string[] = []) {
  return { type: 'chunk' as const, modules: Object.fromEntries(modules.map(id => [id, {}])), imports, dynamicImports };
}

describe('extension UI bundle boundaries', () => {
  it.each(['sidepanel.js', 'content.js', 'espn-page.js', 'options.js'])('rejects Effect rendered into %s', (entry) => {
    expect(() => { validateUiEntryBundle({ [entry]: chunk([effectModule]) }); }).toThrow(failure);
  });

  it.each(['imports', 'dynamicImports'] as const)('follows every transitive %s dependency', (edge) => {
    const entry = { ...chunk(), [edge]: ['intermediate.js'] };
    expect(() => { validateUiEntryBundle({
      'sidepanel.js': entry,
      'intermediate.js': chunk([], ['runtime.js']),
      'runtime.js': chunk([effectModule]),
    }); }).toThrow(failure);
  });

  it('checks shared chunks separately for each UI entry and handles cycles', () => {
    expect(() => { validateUiEntryBundle({
      'content.js': chunk(),
      'sidepanel.js': chunk([], ['ui.js']),
      'options.js': chunk([], ['ui.js']),
      'ui.js': chunk(['/repo/ui.ts'], ['sidepanel.js']),
      'background.js': chunk([effectModule]),
    }); }).not.toThrow();
  });

  it('rejects external Effect imports and Windows module paths', () => {
    expect(() => { validateUiEntryBundle({ 'options.js': chunk([], ['effect/Schema']) }); }).toThrow(failure);
    expect(() => { validateUiEntryBundle({ 'options.js': chunk(['C:\\repo\\node_modules\\effect\\src\\Effect.ts']) }); }).toThrow(failure);
  });

  it('keeps the classic content script self-contained gate', () => {
    expect(() => { validateUiEntryBundle({ 'content.js': chunk([], ['pure.js']), 'pure.js': chunk() }); }).toThrow('must be self-contained');
    expect(() => { validateUiEntryBundle({ 'espn-page.js': chunk([], [], ['pure.js']), 'pure.js': chunk() }); }).toThrow('must be self-contained');
  });
});
