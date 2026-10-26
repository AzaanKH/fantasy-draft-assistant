import { describe, expect, it } from 'vitest';
import { isEffectModule, validateEffectFreeEntries } from './effect-bundle-guard.ts';

const chunk = (values = {}) => ({ type: 'chunk', modules: {}, imports: [], dynamicImports: [], ...values });
const root = 'assets/index-renamed-4321.js';
const entry = values => chunk(values);
const validate = bundle => validateEffectFreeEntries(bundle, [root]);

describe('emitted UI chunk graph Effect boundary', () => {
  it.each(['effect', 'npm:effect@4.0.0', '/@id/effect/Schema', 'effect/Schema', '@effect/platform', '/repo/node_modules/effect/dist/Effect.js',
    '/repo/node_modules/.pnpm/effect@4.0.0/node_modules/effect/Schema.js',
    '/repo/node_modules/.pnpm/@effect+platform@1.0.0/index.js', 'C:\\repo\\node_modules\\@effect\\platform\\index.js', '\0effect/Schema'])('recognizes %s', id => {
    expect(isEffectModule(id)).toBe(true);
    expect(() => validate({ [root]: entry({ modules: { [id]: {} } }) })).toThrow('Decode at the I/O boundary');
  });
  it.each(['imports', 'dynamicImports'])('checks transitive %s and reports the chain', edge => {
    const bundle = { [root]: entry({ [edge]: ['middle.js'] }), 'middle.js': chunk({ [edge]: ['effect/Schema'] }) };
    expect(() => validate(bundle)).toThrow(`${root} -> middle.js -> effect/Schema`);
  });
  it('handles cycles and permits unused Effect chunks', () => {
    expect(() => validate({
      [root]: entry({ imports: ['pure.js'] }), 'pure.js': chunk({ dynamicImports: [root] }),
      'unused.js': chunk({ modules: { effect: {} } }),
    })).not.toThrow();
  });
  it('requires explicitly requested emitted roots', () => {
    expect(() => validateEffectFreeEntries({}, [])).toThrow('No emitted UI entry roots');
    expect(() => validateEffectFreeEntries({}, ['missing.js'])).toThrow('Missing emitted UI entry');
  });
  it('checks every requested root without mistaking an asset for a chunk', () => {
    expect(() => validateEffectFreeEntries({ 'index.html': { type: 'asset' }, [root]: entry(), 'second.js': entry({ dynamicImports: ['@effect/platform'] }) }, [root, 'second.js'])).toThrow('second.js');
  });
});
