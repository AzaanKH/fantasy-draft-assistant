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
