/**
 * Minimum usable sizes for core draft data. The browser readiness check, the CLI readiness
 * report and the data-quality script all read these, so they cannot drift apart.
 */
export const READINESS_MINIMUMS = {
  rankings: 350,
  identities: 800,
  /** Share of ranked players matched to a canonical identity, from 0 to 1. */
  identityRankingMatchRate: 0.98,
  defenses: 32,
  predictions: 800,
  contracts: 50,
} as const;

/** The identity coverage requirement as readers see it, such as "98%". */
export function formatIdentityCoverage(): string {
  return `${String(Math.round(READINESS_MINIMUMS.identityRankingMatchRate * 100))}%`;
}
