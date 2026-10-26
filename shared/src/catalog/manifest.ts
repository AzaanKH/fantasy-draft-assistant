type Classification = 'tracked' | 'private';
type Entry = {
  readonly path: string;
  readonly browser: 'all' | 'local' | 'none';
  readonly classification: Classification;
  readonly source: string;
  readonly notes: string;
};
declare const catalogFile: unique symbol;
type CatalogFile = symbol & { readonly [catalogFile]: true };
const registry = new Map<symbol, Entry>();

function file(name: string, browser: Entry['browser'], classification: Classification, docs: Pick<Entry, 'source' | 'notes'>): CatalogFile {
  const handle = Symbol(name) as CatalogFile;
  registry.set(handle, { path: `data/${name}.json`, browser, classification, ...docs });
  return handle;
}

export const CATALOG = {
  contracts: file('contracts', 'local', 'tracked', {
    source: 'nflverse historical contracts sourced from OverTheCap',
    notes: 'Informational contract context; a passing backtest alone does not enable live recommendation influence.',
  }),
  snapshot: file('fantasypros-snapshot', 'all', 'private', {
    source: 'FantasyPros API or manual fallback',
    notes: 'Current ECR, consensus PPR ADP, projections, and news.',
  }),
  survival: file('league-history/survival-model', 'all', 'private', {
    source: 'Imported league draft history plus Sleeper proxy',
    notes: 'Room-specific timing adjustment, not player-quality training data.',
  }),
  identities: file('player-identity', 'all', 'private', {
    source: 'Generated from FantasyPros and Sleeper',
    notes: 'Canonical IDs, aliases, and explicit team-defense mappings.',
  }),
  predictions: file('predictions', 'all', 'private', {
    source: 'DuckDB prediction pipeline',
    notes: 'Includes league scoring plus leakage-safe trailing snap-share and Next Gen Stats adjustments.',
  }),
  policy: file('recommendation-policy', 'all', 'tracked', {
    source: 'Reviewed runtime configuration',
    notes: 'Names `best-pick-policy` and controls optional signals and shadow logging. Backtests do not rewrite this file.',
  }),
  sleeper: file('sleeper-adp', 'all', 'tracked', {
    source: 'Sleeper `/v1/players/nfl`',
    notes: '`search_rank` proxy only; it is not observed-draft ADP.',
  }),
  environment: file('team-environment', 'all', 'tracked', {
    source: 'nflverse completed-season team stats',
    notes: 'Reproducible baseline; offseason changes remain separate signals.',
  }),
  settings: file('primary-league-settings', 'none', 'private', {
    source: 'Provider-confirmed Primary League profile',
    notes: 'Season-scoped acceptance configuration for the 10-team, 14-round league. It does not expire with age; refresh `confirmedAt` only after verifying a new season, draft, league, scoring configuration, or roster configuration.',
  }),
  keepers: file('league-history/current-keepers', 'none', 'private', {
    source: 'Manual late draft-week input',
    notes: 'Add every keeper, mark the user\'s entry with `isMyKeeper`, and set `updatedAt` only when the full list is confirmed. A confirmed list remains valid for its declared season and does not expire with age. The live mock preloads this file before pick 1.',
  }),
  sportsbook: file('sportsbook-snapshot', 'none', 'private', {
    source: 'FanDuel and DraftKings PDF exports',
    notes: 'Over/under consensus inputs plus raw milestone implied-probability signals.',
  }),
  evaluation: file('recommendation-evaluation', 'none', 'tracked', {
    source: 'Roster-aware and contract walk-forward backtests',
    notes: 'Records the historical `pick-ev-v1` architecture, model versions, validation thresholds, and promotion evidence. `generatedAt` belongs to the recommendation backtest and `contractSignalGeneratedAt` to the contract backtest; each run preserves the other\'s fields. Passing a gate does not change runtime configuration.',
  }),
  qualityReport: file('data-quality-report', 'none', 'tracked', {
    source: 'Generated validator report',
    notes: 'Counts, joins, seasons, dependency order, warnings, and failures.',
  }),
  readinessReport: file('draft-readiness-report', 'none', 'tracked', {
    source: 'Generated Draft Readiness evaluator',
    notes: 'Product-blocking Core Draft Data failures, actionable warnings, Optional Signal degradation, and separately identified engineering checks.',
  }),
  modelReport: file('model-report', 'none', 'tracked', {
    source: 'DuckDB prediction pipeline',
    notes: 'Model versions, source responsibilities, fitted position features, and table counts.',
  }),
  bundleReport: file('web-bundle-report', 'none', 'tracked', {
    source: 'Web bundle measurement',
    notes: 'Raw and gzip sizes, chunks, and budget checks.',
  }),
  deterministicRehearsal: file('primary-league-deterministic-rehearsal-report', 'none', 'tracked', {
    source: 'Deterministic product rehearsal',
    notes: 'Transition checks, reconciliation outcomes, final pick integrity, rosters, and remaining availability.',
  }),
  rehearsal: file('primary-league-rehearsal', 'none', 'private', {
    source: 'Sleeper draft metadata plus operator confirmation',
    notes: 'Exact draft and league IDs, scheduled timing, confirmed 14-round configuration, and real-provider rehearsal status. Deterministic tests do not depend on this file.',
  }),
  releaseReport: file('primary-league-release-gate-report', 'none', 'private', {
    source: 'Release-gate runner',
    notes: 'Separate engineering, data-quality, deterministic product, real-provider, warning, and Optional Signal outcomes.',
  }),
  prepReport: file('draft-prep-report', 'none', 'private', {
    source: 'Generated report',
    notes: 'Machine-readable draft-week summary.',
  }),
  historicalReport: file('historical-snapshot-report', 'none', 'private', {
    source: 'Historical snapshot builder',
    notes: 'As-of-draft source coverage and leakage checks.',
  }),
  leagueHistory: file('league-history/leagueDraftHistory', 'none', 'private', {
    source: 'Imported league draft history',
    notes: 'Private historical selections used by the survival model and backtests.',
  }),
  ecr: file('ecr-rankings', 'none', 'private', {
    source: 'FantasyPros manual scrape',
    notes: 'Raw ECR fallback input for the normalized snapshot.',
  }),
  experiments: file('primary-league-experiments', 'none', 'private', {
    source: 'Primary League experiment runner',
    notes: 'Decision experiment results and comparison evidence.',
  }),
} as const;

export function catalogMetadata(): readonly Entry[] {
  return [...registry.values()];
}

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

const privateDataPrefixes = ['data/model/', 'data/league-history/raw/', 'data/shadow-logs/', 'data/rehearsal-evidence/'];

export function catalogRetentionMetadata(): { readonly trackedPaths: readonly string[]; readonly privatePrefixes: readonly string[] } {
  return {
    trackedPaths: [...trackedModelPlaceholders, ...[...demoFiles].map(name => `demo-data/${name}`)],
    privatePrefixes: [...privateDataPrefixes],
  };
}

export function catalogDataClassification(path: string): Classification | null {
  if (path.split('/').some(segment => segment === '.' || segment === '..' || segment === '')) return null;
  if (trackedModelPlaceholders.has(path) || path.startsWith('demo-data/') && demoFiles.has(path.slice('demo-data/'.length))) return 'tracked';
  for (const entry of registry.values()) if (entry.path === path) return entry.classification;
  if (privateDataPrefixes.some(prefix => path.startsWith(prefix))) return 'private';
  return null;
}
