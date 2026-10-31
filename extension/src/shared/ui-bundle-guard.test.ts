import { describe, expect, it } from 'vitest';
import { validateClassicContentScript, validateExtensionPageBundle } from '../../config/ui-bundle-guard';

const failure = 'Decode at the I/O boundary; UI entries use plain predicates';
const effectModule = '/repo/node_modules/.pnpm/effect@4.0.0/node_modules/effect/src/Schema.ts';
function chunk(modules: readonly string[] = [], imports: readonly string[] = [], dynamicImports: readonly string[] = []) {
  return { type: 'chunk' as const, modules: Object.fromEntries(modules.map(id => [id, {}])), imports, dynamicImports };
}

function validate(bundle: Parameters<typeof validateExtensionPageBundle>[0]) {
  validateExtensionPageBundle({ 'sidepanel.js': chunk(), 'options.js': chunk(), ...bundle });
}

describe('extension UI bundle boundaries', () => {
  it('rejects missing roots', () => {
    expect(() => { validateExtensionPageBundle({}); }).toThrow('Missing emitted UI entry');
    expect(() => { validateClassicContentScript({}, 'content.js'); }).toThrow('Missing emitted UI entry');
  });

  it.each(['sidepanel.js', 'options.js'])('rejects Effect rendered into %s', (entry) => {
    expect(() => { validate({ [entry]: chunk([effectModule]) }); }).toThrow(failure);
  });

  it.each(['content.js', 'espn-page.js'])('rejects Effect rendered into %s', (entry) => {
    expect(() => { validateClassicContentScript({ [entry]: chunk([effectModule]) }, entry); }).toThrow(failure);
  });

  it.each(['imports', 'dynamicImports'] as const)('follows every transitive %s dependency', (edge) => {
    const entry = { ...chunk(), [edge]: ['intermediate.js'] };
    expect(() => { validate({
      'sidepanel.js': entry,
      'intermediate.js': chunk([], ['runtime.js']),
      'runtime.js': chunk([effectModule]),
    }); }).toThrow(failure);
  });

  it('checks shared chunks separately for each UI entry and handles cycles', () => {
    expect(() => { validate({
      'sidepanel.js': chunk([], ['ui.js']),
      'options.js': chunk([], ['ui.js']),
      'ui.js': chunk(['/repo/ui.ts'], ['sidepanel.js']),
      'background.js': chunk([effectModule]),
    }); }).not.toThrow();
  });

  it('rejects external Effect imports and Windows module paths', () => {
    expect(() => { validate({ 'options.js': chunk([], ['effect/Schema']) }); }).toThrow(failure);
    expect(() => { validate({ 'options.js': chunk(['C:\\repo\\node_modules\\effect\\src\\Effect.ts']) }); }).toThrow(failure);
  });

  it('keeps the classic content script self-contained gate', () => {
    expect(() => { validateClassicContentScript({ 'content.js': chunk([], ['pure.js']), 'pure.js': chunk() }, 'content.js'); })
      .toThrow('must be self-contained');
    expect(() => { validateClassicContentScript({ 'espn-page.js': chunk([], [], ['pure.js']), 'pure.js': chunk() }, 'espn-page.js'); })
      .toThrow('must be self-contained');
  });
});
