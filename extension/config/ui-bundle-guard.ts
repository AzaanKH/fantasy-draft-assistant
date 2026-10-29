import { validateEffectFreeEntries, type EmittedBundle } from '../../scripts/effect-bundle-guard';

export function validateExtensionPageBundle(bundle: EmittedBundle): void {
  validateEffectFreeEntries(bundle, ['sidepanel.js', 'options.js']);
}

export function validateClassicContentScript(bundle: EmittedBundle, fileName: string): void {
  validateEffectFreeEntries(bundle, [fileName]);
  const output = bundle[fileName];
  if (output?.type === 'chunk' && (output.imports.length > 0 || output.dynamicImports.length > 0)) {
    throw new Error(`${fileName} must be self-contained because Chrome content scripts are not ES modules`);
  }
}
