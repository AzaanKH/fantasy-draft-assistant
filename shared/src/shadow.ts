import type { ShadowRecommendationEvent } from './catalog/shadow-decoders.js';

export type { ShadowPredictionDependencies, ShadowPredictionFreshness, ShadowRecommendation, ShadowRecommendationEvent } from './catalog/shadow-decoders.js';

/** The seasons a Shadow Recommendation must agree on before it counts as that season's evidence. */
export interface ShadowSeasons {
  /** The season the workspace is drafting. */
  readonly workspace: number;
  /** The season the prediction artifact was built for; null when the artifact does not record one. */
  readonly artifact: number | null | undefined;
  /** The season the recommendation policy logs. */
  readonly policy: number;
}

export type ShadowSeasonEligibility =
  | { readonly eligible: true; readonly season: number }
  | { readonly eligible: false; readonly reason: string };

/**
 * A Shadow Recommendation is logged only when the workspace, the prediction artifact's target season, and the policy
 * season all agree. An artifact with no recorded target season fails closed rather than guessing from its build time.
 */
export function shadowSeasonEligibility(seasons: ShadowSeasons): ShadowSeasonEligibility {
  const { workspace, artifact, policy } = seasons;
  if (artifact == null) {
    return { eligible: false, reason: 'The prediction artifact does not record its target season; rebuild it with `pnpm model:dataset`.' };
  }
  if (artifact !== workspace || policy !== workspace) {
    return { eligible: false, reason: `Seasons disagree: workspace ${String(workspace)}, prediction artifact ${String(artifact)}, policy ${String(policy)}.` };
  }
  return { eligible: true, season: workspace };
}

/** The server's check: the event's season, its artifact's target season, and the log's season all agree. */
export function isShadowEventSeasonEligible(event: ShadowRecommendationEvent, logSeason: number): boolean {
  return shadowSeasonEligibility({ workspace: event.season, artifact: event.experiment.targetSeason, policy: logSeason }).eligible;
}
