export const BROWSER_DATA_FILES = [
  'data/contracts.json',
  'data/fantasypros-snapshot.json',
  'data/league-history/survival-model.json',
  'data/player-identity.json',
  'data/predictions.json',
  'data/recommendation-policy.json',
  'data/sleeper-adp.json',
  'data/team-environment.json',
] as const;

export const BROWSER_DATA_ALLOWLIST: ReadonlySet<string> = new Set(
  BROWSER_DATA_FILES
);

/**
 * Files a demo build must take from demo-data/. The demo app does not request
 * contract context, so contracts.json is left out rather than copied from data/.
 */
export const DEMO_BROWSER_DATA_FILES = BROWSER_DATA_FILES.filter(
  (fileName) => fileName !== 'data/contracts.json'
);
