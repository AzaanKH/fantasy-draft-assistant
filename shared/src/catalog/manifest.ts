type Entry = { readonly path: string; readonly browser: 'all' | 'local' | 'none' };
declare const catalogFile: unique symbol;
type CatalogFile = symbol & { readonly [catalogFile]: true };
const registry = new Map<symbol, Entry>();

function file(name: string, browser: Entry['browser']): CatalogFile {
  const handle = Symbol(name) as CatalogFile;
  registry.set(handle, { path: `data/${name}.json`, browser });
  return handle;
}

export const CATALOG = {
  contracts: file('contracts', 'local'),
  snapshot: file('fantasypros-snapshot', 'all'),
  survival: file('league-history/survival-model', 'all'),
  identities: file('player-identity', 'all'),
  predictions: file('predictions', 'all'),
  policy: file('recommendation-policy', 'all'),
  sleeper: file('sleeper-adp', 'all'),
  environment: file('team-environment', 'all'),
  settings: file('primary-league-settings', 'none'),
  keepers: file('league-history/current-keepers', 'none'),
  sportsbook: file('sportsbook-snapshot', 'none'),
  evaluation: file('recommendation-evaluation', 'none'),
} as const;

export function catalogPath(handle: CatalogFile): string {
  const entry = registry.get(handle);
  if (!entry) throw new Error('Unknown catalog file');
  return entry.path;
}

export function browserDataFiles(source: 'local' | 'demo'): readonly string[] {
  return [...registry.values()].filter(entry => entry.browser === 'all' || source === 'local' && entry.browser === 'local').map(entry => entry.path);
}
