/**
 * The Assistant's decision rules, shared by the web app's cards, analysis and Compare and by the side panel, so no
 * surface decides on its own. Each function returns a structured result; the surfaces only word it.
 */
import type { DraftDecisionView } from '../recommendations/draft-decision.js';
import type { Recommendation } from '../../draft.js';
import { getWaitingCostSummary } from './assistant-analysis.js';

/** Below this chance of lasting to the next pick, take the player now. */
export const TAKE_NOW_BELOW = 0.5;
/** Below this chance, "take now" says the player is likely gone (rather than may be gone). */
export const LIKELY_GONE_BELOW = 0.35;
/** The last player in a tier is a take-now below this chance, because the next tier projects fewer points. */
export const TAKE_NOW_TIER_END_BELOW = 0.7;
/**
 * Expected projected points lost by waiting at or above which "Can wait" would overclaim: the player probably lasts,
 * but the chance they do not, times what the fallback gives up, is a real cost, so the verdict hedges instead.
 */
export const MATERIAL_WAIT_COST = 5;

export type TakeOrWaitKind = 'take-now' | 'can-wait' | 'likely-available';

/** Why the verdict is what it is, for the surface to put in words. */
export type TakeOrWaitBasis =
  | 'likely-gone'
  | 'may-be-gone'
  | 'tier-end'
  /** Probably lasts, but there is no cost-of-waiting estimate, so waiting is not known to be safe. */
  | 'cost-unknown'
  /** Probably lasts, but waiting costs at least MATERIAL_WAIT_COST projected points. */
  | 'cost-material'
  /** Probably lasts and waiting costs under MATERIAL_WAIT_COST points (zero included). */
  | 'cost-small';

export interface TakeOrWaitDecision {
  readonly kind: TakeOrWaitKind;
  readonly basis: TakeOrWaitBasis;
  /** The next pick the decision is about ("2.08"), when known. */
  readonly nextPickLabel: string | undefined;
}

/**
 * Take now, can wait, or likely available. Null without an availability estimate: no verdict rather than a guess.
 * A null cost means it is not estimated; zero is an estimate (waiting costs nothing) and reads Can wait.
 */
export function decideTakeOrWait({ survival, nextPickLabel, tierEnds, costOfWaiting }: {
  readonly survival: number | undefined;
  readonly nextPickLabel: string | undefined;
  readonly tierEnds: boolean;
  readonly costOfWaiting: number | null;
}): TakeOrWaitDecision | null {
  if (typeof survival !== 'number' || !Number.isFinite(survival)) return null;
  const decision = (kind: TakeOrWaitKind, basis: TakeOrWaitBasis): TakeOrWaitDecision => ({ kind, basis, nextPickLabel });
  if (survival < TAKE_NOW_BELOW) return decision('take-now', survival < LIKELY_GONE_BELOW ? 'likely-gone' : 'may-be-gone');
  if (tierEnds && survival < TAKE_NOW_TIER_END_BELOW) return decision('take-now', 'tier-end');
  if (costOfWaiting === null || !Number.isFinite(costOfWaiting)) return decision('likely-available', 'cost-unknown');
  if (costOfWaiting >= MATERIAL_WAIT_COST) return decision('likely-available', 'cost-material');
  return decision('can-wait', 'cost-small');
}

/** Whether the recommendation is the last of its tier, from the same fields the Tier ends chip reads. */
export function isTierEnding(recommendation: Pick<Recommendation, 'diagnostics'>): boolean {
  return recommendation.diagnostics?.isLastInTier === true || recommendation.diagnostics?.tierRemaining === 1;
}

/**
 * The chance this recommendation lasts to the next pick, from the survival model's own fields. Undefined when the
 * model has not estimated it, or when the manager has no later pick (the model marks its output and leaves the next
 * pick number out), so a final pick never gets a verdict.
 */
export function getNextPickSurvival(recommendation: Pick<Recommendation, 'diagnostics'>): number | undefined {
  const diagnostics = recommendation.diagnostics;
  if (!diagnostics) return undefined;
  if (diagnostics.survivalModelSource !== undefined && diagnostics.nextPickNumber === undefined) return undefined;
  const probability = diagnostics.nextPickSurvivalProbability;
  return typeof probability === 'number' && Number.isFinite(probability) ? probability : undefined;
}

/** The one verdict for a recommendation: cards, analysis and side panel all read it, so they never disagree. */
export function getRecommendationDecision(recommendation: Recommendation): TakeOrWaitDecision | null {
  const waiting = getWaitingCostSummary(recommendation);
  return decideTakeOrWait({
    survival: getNextPickSurvival(recommendation),
    nextPickLabel: waiting.nextPickLabel ?? recommendation.diagnostics?.nextPickLabel,
    tierEnds: isTierEnding(recommendation),
    costOfWaiting: waiting.costOfWaiting,
  });
}

/**
 * Compare's preference between two players: the better overall rank for this pick; when neither is in the overall
 * order (both only ranked within their positions), the higher model score; the first player on a tie.
 */
export function getComparisonPreference(
  decision: Pick<DraftDecisionView, 'rankByPlayerId'>,
  first: Recommendation,
  second: Recommendation
): { readonly preferred: Recommendation; readonly other: Recommendation } {
  const firstRank = decision.rankByPlayerId.get(first.playerId);
  const secondRank = decision.rankByPlayerId.get(second.playerId);
  const secondWins = firstRank === undefined && secondRank === undefined
    ? second.score > first.score
    : (secondRank ?? Number.POSITIVE_INFINITY) < (firstRank ?? Number.POSITIVE_INFINITY);
  return secondWins ? { preferred: second, other: first } : { preferred: first, other: second };
}

/**
 * Every analysed player in the order Compare offers them: the overall order first, then everyone else by model score
 * (highest first, then by name), so either Compare slot can reach anyone the model analyses.
 */
export function orderAnalysedRecommendations(
  overall: readonly Recommendation[],
  analysed: Iterable<Recommendation>
): readonly Recommendation[] {
  const overallIds = new Set(overall.map((item) => item.playerId));
  const rest = [...analysed].filter((item) => !overallIds.has(item.playerId))
    .sort((first, second) => second.score - first.score || first.playerName.localeCompare(second.playerName));
  return [...overall, ...rest];
}
