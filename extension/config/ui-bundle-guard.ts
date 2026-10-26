import { validateEffectFreeEntries, type EmittedBundle } from '../../scripts/effect-bundle-guard';

export function validateUiEntryBundle(bundle: EmittedBundle): void {
  validateEffectFreeEntries(bundle, ['sidepanel.js', 'content.js', 'espn-page.js', 'options.js']);
  for (const fileName of ['content.js', 'espn-page.js']) {
    const output = bundle[fileName];
    if (output?.type === 'chunk' && (output.imports.length > 0 || output.dynamicImports.length > 0)) {
      throw new Error(`${fileName} must be self-contained because Chrome content scripts are not ES modules`);
    }
  }
}
