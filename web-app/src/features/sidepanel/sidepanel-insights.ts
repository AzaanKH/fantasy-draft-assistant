/** Pure helpers shared by the side panel views: availability, compact decision text and roster-need labels. */
import { toWholePercent, type Percent } from '@fantasy-draft/shared/units';
import { availabilityProbability, describeMissingAvailability, formatAvailabilityPercent, getNextPickAvailability } from '@/lib/next-pick-availability';
import { type PositionNeed, type Recommendation } from '@fantasy-draft/shared/draft';
import type { TakeOrWaitVerdict } from '@/features/draft-room/suggestion-reasons';

/** The shared next-pick availability, as a whole percent; null when there is no estimate or no later pick. */
export function getSurvival(recommendation: Recommendation | undefined): Percent | null {
  const probability = availabilityProbability(getNextPickAvailability(recommendation?.diagnostics));
  return probability === undefined ? null : toWholePercent(probability);
}
/** "72%", or the shared label for a missing figure: "No later pick" on the final pick, "Not estimated" otherwise. */
export function getAvailabilityText(recommendation: Recommendation | undefined): string {
  const availability = getNextPickAvailability(recommendation?.diagnostics);
  return describeMissingAvailability(availability) ?? formatAvailabilityPercent(availability);
}
/** What to say in place of a missing percentage: the final pick has nothing to wait for. */
export function getMissingSurvivalText(recommendation: Recommendation | undefined, pending: string): string {
  return getNextPickAvailability(recommendation?.diagnostics).kind === 'no-next-pick' ? 'No later pick' : pending;
}
/**
 * The hero's one sentence: what the stat line beside it does not already say (VOR, tier and availability are
 * shown as figures). Null when there is nothing to add.
 */
export function getCompactDecisionExplanation(recommendation: Recommendation): string | null {
  if (getNextPickAvailability(recommendation.diagnostics).kind === 'no-next-pick') return 'Your last pick: take the most value left.';
  const timing = recommendation.decisionFactors?.draftTiming;
  if (!timing || timing.nextPickNumber === undefined) return null;
  const at = timing.nextPickLabel ?? `#${String(timing.nextPickNumber)}`;
  const fallback = timing.expectedAlternative
    ? `If you wait, ${timing.expectedAlternative.playerName} is the likely ${recommendation.position} at ${at}.`
    : `No other ${recommendation.position} is projected for ${at}.`;
  return timing.materiallyChangedOrdering ? `${fallback} Timing moved this pick up.` : fallback;
}
/**
 * The roster's state at a position in the web app's own words: "2 open", "FLEX open" or "Filled". Never a verdict
 * label such as "Can wait", which means something else on the cards.
 */
export function getNeedLabel(need: PositionNeed): string {
  const open = Math.max(0, need.startersNeeded - need.startersFilled);
  if (open > 0) return `${String(open)} open`;
  if (need.isFlexEligible && need.flexSlotsFilled < need.flexSlotsNeeded) return 'FLEX open';
  return 'Filled';
}
/** "1 / 2 filled": the starter slots behind the label. */
export function getNeedDescription(need: PositionNeed): string {
  return `${String(need.startersFilled)} / ${String(need.startersNeeded)} filled`;
}

/**
 * The answer card's headline, from the shared verdict: "Take X now." on your pick (never "if available": it is
 * yours to take), "Take X if available." before it, otherwise the best current option.
 */
export function getAnswerHeadline({ name, verdict, onClock, explainsComparison }: {
  readonly name: string;
  readonly verdict: TakeOrWaitVerdict | null;
  readonly onClock: boolean;
  readonly explainsComparison: boolean;
}): string {
  if (explainsComparison) return `${name} has the edge in this comparison.`;
  if (verdict?.kind === 'take-now') return onClock ? `Take ${name} now.` : `Take ${name} if available.`;
  return `${name} is the best current option.`;
}

/** "Can I wait?" answered from the shared verdict: "No. Likely gone by 2.08." */
export function getWaitAnswer(verdict: TakeOrWaitVerdict | null, finalPick: boolean): string {
  if (finalPick) return 'This is your final pick, so there is nothing to wait for.';
  if (!verdict) return 'There is no estimate yet of whether he lasts to your next pick.';
  const reason = `${verdict.reason.charAt(0).toUpperCase()}${verdict.reason.slice(1)}.`;
  if (verdict.kind === 'take-now') return `No. ${reason}`;
  if (verdict.kind === 'can-wait') return `Yes. ${reason}`;
  return `Probably. ${reason}`;
}

export function getNeedSlotSummary(need: PositionNeed): string {
  const fixedSummary = `${String(need.startersFilled)} of ${String(need.startersNeeded)} starter slots filled`;
  if (!need.isFlexEligible || need.flexSlotsNeeded === 0) return fixedSummary;
  return `${fixedSummary}; ${String(need.flexSlotsFilled)} of ${String(need.flexSlotsNeeded)} FLEX slots filled`;
}
