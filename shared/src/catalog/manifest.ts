type Classification = 'tracked' | 'private';
type Entry = { readonly path: string; readonly browser: 'all' | 'local' | 'none'; readonly classification: Classification };
declare const catalogFile: unique symbol;
type CatalogFile = symbol & { readonly [catalogFile]: true };
const registry = new Map<symbol, Entry>();

function file(name: string, browser: Entry['browser'], classification: Classification): CatalogFile {
  const handle = Symbol(name) as CatalogFile;
  registry.set(handle, { path: `data/${name}.json`, browser, classification });
  return handle;
}

export const CATALOG = {
  contracts: file('contracts', 'local', 'tracked'),
  snapshot: file('fantasypros-snapshot', 'all', 'private'),
  survival: file('league-history/survival-model', 'all', 'private'),
  identities: file('player-identity', 'all', 'private'),
  predictions: file('predictions', 'all', 'private'),
  policy: file('recommendation-policy', 'all', 'tracked'),
  sleeper: file('sleeper-adp', 'all', 'tracked'),
  environment: file('team-environment', 'all', 'tracked'),
  settings: file('primary-league-settings', 'none', 'private'),
  keepers: file('league-history/current-keepers', 'none', 'private'),
  sportsbook: file('sportsbook-snapshot', 'none', 'private'),
  evaluation: file('recommendation-evaluation', 'none', 'tracked'),
  qualityReport: file('data-quality-report', 'none', 'tracked'),
  readinessReport: file('draft-readiness-report', 'none', 'tracked'),
  modelReport: file('model-report', 'none', 'tracked'),
  bundleReport: file('web-bundle-report', 'none', 'tracked'),
  deterministicRehearsal: file('primary-league-deterministic-rehearsal-report', 'none', 'tracked'),
  rehearsal: file('primary-league-rehearsal', 'none', 'private'),
  releaseReport: file('primary-league-release-gate-report', 'none', 'private'),
  prepReport: file('draft-prep-report', 'none', 'private'),
  historicalReport: file('historical-snapshot-report', 'none', 'private'),
  leagueHistory: file('league-history/leagueDraftHistory', 'none', 'private'),
  ecr: file('ecr-rankings', 'none', 'private'),
  experiments: file('primary-league-experiments', 'none', 'private'),
} as const;

export function catalogPath(handle: CatalogFile): string {
  const entry = registry.get(handle);
  if (!entry) throw new Error('Unknown catalog file');
  return entry.path;
}

export function browserDataFiles(source: 'local' | 'demo'): readonly string[] {
  return [...registry.values()].filter(entry => entry.browser === 'all' || source === 'local' && entry.browser === 'local').map(entry => entry.path);
}


const trackedModelPlaceholders = new Set(['data/model/.gitkeep', 'data/model/backtests/.gitkeep', 'data/model/normalized/.gitkeep', 'data/model/raw/.gitkeep']);
const demoFiles = new Set(['README.md', 'fantasypros-snapshot.json', 'league-history/current-keepers.json', 'league-history/survival-model.json',
  'player-identity.json', 'predictions.json', 'primary-league-settings.json', 'recommendation-policy.json', 'sleeper-adp.json', 'team-environment.json']);

export function catalogDataClassification(path: string): Classification | null {
  if (path.split('/').some(segment => segment === '.' || segment === '..' || segment === '')) return null;
  if (trackedModelPlaceholders.has(path) || path.startsWith('demo-data/') && demoFiles.has(path.slice('demo-data/'.length))) return 'tracked';
  for (const entry of registry.values()) if (entry.path === path) return entry.classification;
  if (['data/model/', 'data/league-history/raw/', 'data/shadow-logs/', 'data/rehearsal-evidence/'].some(prefix => path.startsWith(prefix))) return 'private';
  return null;
}
