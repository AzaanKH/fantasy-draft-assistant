interface OutputChunk {
  readonly type: 'chunk';
  readonly imports: readonly string[];
  readonly dynamicImports: readonly string[];
  readonly modules: Readonly<Record<string, unknown>>;
}

type Output = OutputChunk | { readonly type: 'asset' };
type Bundle = Readonly<Record<string, Output | undefined>>;

function isEffectModule(id: string): boolean {
  return /(?:^|\/node_modules\/)(?:effect(?:\/|$)|@effect\/)/.test(id.replaceAll('\\', '/'));
}

export function validateUiEntryBundle(bundle: Bundle): void {
  for (const entry of ['sidepanel.js', 'content.js', 'espn-page.js', 'options.js']) {
    const pending = [entry];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const fileName = pending.pop();
      if (fileName === undefined || visited.has(fileName)) continue;
      visited.add(fileName);
      const output = bundle[fileName];
      if (output?.type !== 'chunk') continue;
      for (const dependency of [...Object.keys(output.modules), ...output.imports, ...output.dynamicImports]) {
        if (isEffectModule(dependency)) {
          throw new Error(`${entry} includes ${dependency}: decode in the background; UI entries use plain predicates`);
        }
      }
      pending.push(...output.imports, ...output.dynamicImports);
    }
  }
  for (const fileName of ['content.js', 'espn-page.js']) {
    const output = bundle[fileName];
    if (output?.type === 'chunk' && (output.imports.length > 0 || output.dynamicImports.length > 0)) {
      throw new Error(`${fileName} must be self-contained because Chrome content scripts are not ES modules`);
    }
  }
}
