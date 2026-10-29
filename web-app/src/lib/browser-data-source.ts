/** Which tree Vite serves and bundles the browser data files from. */
export type BrowserDataSource = 'local' | 'demo';
export type BrowserDataPhase = 'serve' | 'build';

export function resolveDataSource(env: Readonly<Record<string, string | undefined>>): BrowserDataSource {
  const source = env['BROWSER_DATA_SOURCE'] ?? 'local';
  if (source !== 'local' && source !== 'demo') {
    throw new Error(`BROWSER_DATA_SOURCE must be "local" or "demo"; got "${source}".`);
  }
  if (env['VITE_DEMO_MODE'] === 'true' && source !== 'demo') {
    throw new Error('VITE_DEMO_MODE=true requires BROWSER_DATA_SOURCE=demo.');
  }
  return source;
}

/** Repo-relative files to read, in order, for a data/ browser file. */
export function browserDataCandidates(
  source: BrowserDataSource,
  phase: BrowserDataPhase,
  fileName: string
): readonly string[] {
  if (source === 'local') return [fileName];
  const demoFile = fileName.replace(/^data\//, 'demo-data/');
  return phase === 'serve' ? [demoFile, fileName] : [demoFile];
}
