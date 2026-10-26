interface Chunk {
  readonly type: 'chunk';
  readonly imports: readonly string[];
  readonly dynamicImports: readonly string[];
  readonly modules: Readonly<Record<string, unknown>>;
}
export type EmittedBundle = Readonly<Record<string, Chunk | { readonly type: 'asset' } | undefined>>;

export function isEffectModule(id: string): boolean {
  const normalized = id.replaceAll('\\', '/').replace(/^\0/, '').replace(/^(?:npm:|\/@id\/)/, '');
  return /(?:^|\/node_modules\/)(?:effect(?:[/?@]|$)|@effect\/)/.test(normalized) ||
    /(?:^|\/)\.pnpm\/(?:effect@|@effect\+)/.test(normalized);
}

export function validateEffectFreeEntries(bundle: EmittedBundle, entries: readonly string[]): void {
  if (!entries.length) throw new Error('No emitted UI entry roots found. Check the build entry configuration.');
  for (const entry of entries) {
    if (bundle[entry]?.type !== 'chunk') throw new Error(`Missing emitted UI entry ${entry}. Check the build entry configuration.`);
    const pending = [[entry]];
    const visited = new Set<string>();
    while (pending.length) {
      const chain = pending.pop();
      if (!chain) continue;
      const id = chain[chain.length - 1];
      if (id === undefined || visited.has(id)) continue;
      visited.add(id);
      if (isEffectModule(id)) {
        throw new Error(`${chain.join(' -> ')} includes Effect. Decode at the I/O boundary; UI entries use plain predicates.`);
      }
      const output = bundle[id];
      if (output?.type !== 'chunk') continue;
      for (const module of Object.keys(output.modules)) {
        if (isEffectModule(module)) {
          throw new Error(`${[...chain, module].join(' -> ')} includes Effect. Decode at the I/O boundary; UI entries use plain predicates.`);
        }
      }
      for (const dependency of [...output.imports, ...output.dynamicImports]) pending.push([...chain, dependency]);
    }
  }
}
