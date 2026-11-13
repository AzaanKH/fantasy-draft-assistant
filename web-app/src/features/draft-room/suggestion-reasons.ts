import type { Player } from '@fantasy-draft/shared/league';
import {
  decideTakeOrWait,
  getRecommendationDecision,
  hasNearZeroValue,
  isTierEnding,
  MATERIAL_WAIT_COST,
  TAKE_NOW_BELOW,
  TAKE_NOW_TIER_END_BELOW,
  type PositionNeed,
  type Recommendation,
  type TakeOrWaitDecision,
} from '@fantasy-draft/shared/draft';
import type { StatusTone } from '@/components/InjuryTag';
import { getPlayerAdp } from '@/lib/player-status';
import { formatGapToTop, GAP_BASIS, type GapToTop } from './suggestion-separation';

/** ADP minus expert rank beyond which the market is meaningfully out of line (matches the pool's vs ADP colors). */
const MARKET_GAP = 5;
/** Cards show at most this many reason chips; the full prose stays one tap away. */
export const MAX_REASON_CHIPS = 2;

export interface ReasonChip {
  readonly key: 'tier-ends' | 'need' | 'value' | 'reach' | 'bye-conflict';
  readonly label: string;
  /** Plain-language description for the tooltip and screen readers. */
  readonly detail: string;
  readonly tone: StatusTone;
}

/**
 * Warnings outrank positive reasons, so the chip limit can never drop a warning. Injury news is not a chip: the
 * card shows it as its own tag beside the name, outside the limit.
 */
const CHIP_PRIORITY: Readonly<Record<ReasonChip['key'], number>> = {
  'bye-conflict': 1,
  'tier-ends': 2,
  need: 3,
  value: 4,
  reach: 5,
};

/**
 * Short, scannable reasons derived only from data the recommendation already carries (tier position,
 * open starter slots, market gap, roster byes). Nothing is inferred beyond those facts; when a fact
 * is missing its chip is simply absent. Warnings come first.
 */
export function getSuggestionReasonChips({ recommendation, player, needs, rosteredPlayers }: {
  readonly recommendation: Pick<Recommendation, 'position' | 'diagnostics'>;
  readonly player: Pick<Player, 'id' | 'position' | 'byeWeek' | 'valueScore' | 'consensusAdp' | 'marketAdp'> | undefined;
  readonly needs: readonly Pick<PositionNeed, 'position' | 'startersFilled' | 'startersNeeded'>[];
  readonly rosteredPlayers: readonly Pick<Player, 'id' | 'name' | 'position' | 'byeWeek'>[];
}): readonly ReasonChip[] {
  const chips: ReasonChip[] = [];
  const diagnostics = recommendation.diagnostics;
  if (diagnostics && isTierEnding(recommendation)) {
    const drop = diagnostics.tierDropoffPoints;
    chips.push({
      key: 'tier-ends', label: 'Tier ends', tone: 'warn',
      detail: `Last ${recommendation.position} left in Tier ${String(diagnostics.tier)}${typeof drop === 'number' && drop > 0 ? `; the next tier projects about ${String(Math.round(drop))} fewer points` : ''}.`,
    });
  }
  const need = needs.find((item) => item.position === recommendation.position);
  if (need && need.startersFilled < need.startersNeeded) {
    const open = need.startersNeeded - need.startersFilled;
    chips.push({
      key: 'need', label: `Need ${recommendation.position}`, tone: 'neutral',
      detail: `${String(open)} of ${String(need.startersNeeded)} ${recommendation.position} starter ${need.startersNeeded === 1 ? 'slot' : 'slots'} still open.`,
    });
  }
  if (player && getPlayerAdp(player) !== null && Number.isFinite(player.valueScore)) {
    const gap = Math.round(player.valueScore);
    if (gap >= MARKET_GAP) chips.push({ key: 'value', label: `Value +${String(gap)}`, tone: 'ok', detail: `Drafters take this player ${String(gap)} spots later than experts rank them.` });
    else if (gap <= -MARKET_GAP) chips.push({ key: 'reach', label: `Reach ${String(gap)}`, tone: 'neutral', detail: `Drafters take this player ${String(-gap)} spots earlier than experts rank them.` });
  }
  if (player) {
    const clash = rosteredPlayers.find((rostered) => rostered.id !== player.id && rostered.position === player.position && rostered.byeWeek === player.byeWeek);
    if (clash) chips.push({ key: 'bye-conflict', label: 'Bye conflict', tone: 'warn', detail: `Shares bye week ${String(player.byeWeek)} with ${clash.name}.` });
  }
  return chips
    .map((chip, order) => ({ chip, order }))
    .sort((first, second) => CHIP_PRIORITY[first.chip.key] - CHIP_PRIORITY[second.chip.key] || first.order - second.order)
    .slice(0, MAX_REASON_CHIPS)
    .map(({ chip }) => chip);
}

export { MATERIAL_WAIT_COST, TAKE_NOW_BELOW, TAKE_NOW_TIER_END_BELOW, isTierEnding };

export const VERDICT_RULE = `Take now when the chance this player is still there at your next pick is under ${String(TAKE_NOW_BELOW * 100)}%, or under ${String(TAKE_NOW_TIER_END_BELOW * 100)}% for the last player in a tier. Can wait when they probably last and waiting costs under ${String(MATERIAL_WAIT_COST)} projected points. Otherwise Likely available: they probably last, but waiting has a real cost or one that is not estimated. The chance is an estimate, not a guarantee.`;

const VERDICT_LABELS = {
  'take-now': 'Take now',
  'can-wait': 'Can wait',
  'likely-available': 'Likely available',
} as const;

export interface TakeOrWaitVerdict {
  // 'likely-available': the player probably lasts, but waiting has a material or unestimated cost, so "Can wait"
  // would overclaim.
  readonly kind: TakeOrWaitDecision['kind'];
  readonly label: (typeof VERDICT_LABELS)[TakeOrWaitDecision['kind']];
  /**
   * The plain conclusion: "likely gone by 2.08". Never a figure another part of the page shows (the card's %, the
   * analysis's cost of waiting), so each timing fact is stated once.
   */
  readonly reason: string;
}

/** The shared decision in words. The rule itself lives in shared/src/draft/assistant/take-or-wait.ts. */
export function describeTakeOrWait(decision: TakeOrWaitDecision): TakeOrWaitVerdict {
  const at = decision.nextPickLabel ?? 'your next pick';
  const reasons: Readonly<Record<TakeOrWaitDecision['basis'], string>> = {
    'likely-gone': `likely gone by ${at}`,
    'may-be-gone': `may be gone by ${at}`,
    'tier-end': `last of the tier, may be gone by ${at}`,
    'cost-unknown': `likely still there at ${at}, but it isn't known whether waiting is safe`,
    'cost-material': `likely still there at ${at}, but waiting has a real cost`,
    'cost-small': `likely still there at ${at}, and waiting costs little`,
  };
  return { kind: decision.kind, label: VERDICT_LABELS[decision.kind], reason: reasons[decision.basis] };
}

/** Null without an availability estimate: no verdict rather than a guess. A null cost means it is not estimated. */
export function getTakeOrWaitVerdict(input: Parameters<typeof decideTakeOrWait>[0]): TakeOrWaitVerdict | null {
  const decision = decideTakeOrWait(input);
  return decision ? describeTakeOrWait(decision) : null;
}

/**
 * The one verdict for a recommendation, shared by the cards, the analysis and the side panel so they never
 * disagree about the same player.
 */
export function getRecommendationVerdict(recommendation: Recommendation): TakeOrWaitVerdict | null {
  const decision = getRecommendationDecision(recommendation);
  return decision ? describeTakeOrWait(decision) : null;
}

/** The analysis's timing line on the final pick, where there is nothing to wait for. */
export const FINAL_PICK_NOTE = 'Final pick. Nothing to wait for.';

/** Next-tier drop, in points, worth stating on a card. */
const NOTABLE_TIER_DROP = 5;

/** Recent picks at one position: "RB run: 4 of last 6 picks". */
export interface PositionRun {
  readonly count: number;
  readonly window: number;
}

/**
 * The card's one line: what sets this card apart from the other three, in plain words. The verdict chip says whether
 * to wait and the big figure gives the chance, so this never repeats either. In order: the last player of a tier,
 * a run on the position, then the value gap to #1 (or, on #1, to #2), which every card
 * has, so no two cards read the same. At most two parts; null when there is nothing to say.
 */
/** A card's one-line summary and the plain-words tooltip explaining exactly the facts it states. */
export interface PlainSuggestionSummary {
  readonly text: string;
  readonly basis: string;
}

/**
 * Why a player with about zero points over a fill-in starter still ranks here, in plain words: an open starter
 * spot or the end of his tier; with neither, only that he is about even with a fill-in starter, so the other parts
 * of the line still explain the pick.
 */
export function describeNearZeroValueReason(
  recommendation: Pick<Recommendation, 'position' | 'diagnostics'>,
  reasons: readonly Pick<ReasonChip, 'key'>[] = []
): PlainSuggestionSummary {
  const position = recommendation.position;
  if (reasons.some((chip) => chip.key === 'need')) {
    return { text: `Fills your open ${position} starter spot`, basis: `He projects about the same as a fill-in ${position}, but your ${position} starter spot is still open, so he is the pick that fills it.` };
  }
  const tier = recommendation.diagnostics?.tier;
  if (isTierEnding(recommendation) && typeof tier === 'number') {
    return { text: `Last ${position} in Tier ${String(tier)}`, basis: `He projects about the same as a fill-in ${position}, but no other ${position} of this value is left; the next tier is a step down.` };
  }
  return { text: `About even with a fill-in ${position}`, basis: `He projects about the same as a fill-in starter at ${position}, so his points are not what puts him here; the rankings and the other facts on this card do.` };
}

/** Every fact a card's line could state, most distinguishing first; the line shows the first two. */
export function getSuggestionSummaryCandidates({ recommendation, gap, run, reasons = [] }: {
  readonly recommendation: Pick<Recommendation, 'position' | 'diagnostics' | 'decisionFactors'>;
  readonly gap: GapToTop | null;
  readonly run: PositionRun | null;
  /** The card's reason chips: an open starter spot explains a pick worth about nothing over a fill-in starter. */
  readonly reasons?: readonly Pick<ReasonChip, 'key'>[];
}): readonly PlainSuggestionSummary[] {
  const parts: PlainSuggestionSummary[] = [];
  const position = recommendation.position;
  // About zero points over a fill-in starter: the real reason leads, so the card never reads as a model error.
  const nearZero = hasNearZeroValue(recommendation) ? describeNearZeroValueReason(recommendation, reasons) : null;
  if (nearZero) parts.push(nearZero);
  const tier = recommendation.diagnostics?.tier;
  const drop = recommendation.decisionFactors?.tierSupply.dropoffPoints ?? recommendation.diagnostics?.tierDropoffPoints;
  const notableDrop = typeof drop === 'number' && drop >= NOTABLE_TIER_DROP ? Math.round(drop) : null;
  if (isTierEnding(recommendation) && typeof tier === 'number' && !nearZero?.text.startsWith('Last ')) {
    parts.push({ text: `Last ${position} in Tier ${String(tier)}`, basis: `No other ${position} of this value is left; the next tier is a step down.` });
  }
  if (run) {
    parts.push({ text: `${position} run: ${String(run.count)} of last ${String(run.window)} picks`, basis: `${String(run.count)} of the last ${String(run.window)} picks were ${position}s, so they may go quickly.` });
  }
  if (gap) parts.push({ text: formatGapToTop(gap), basis: GAP_BASIS });
  if (notableDrop !== null && !isTierEnding(recommendation)) {
    parts.push({ text: `Next ${position} tier −${String(notableDrop)} pts`, basis: `The best ${position} in the next tier is projected to score about ${String(notableDrop)} fewer points.` });
  }
  return parts;
}

/** Facts that tell one player from another when the comparison facts are the same: projected points, then expert rank. */
export function getDistinguishingFacts(
  recommendation: Pick<Recommendation, 'diagnostics'>,
  player: Pick<Player, 'projectedPoints' | 'ecrRank'> | undefined
): readonly PlainSuggestionSummary[] {
  const facts: PlainSuggestionSummary[] = [];
  const projected = recommendation.diagnostics?.projectedPoints ?? player?.projectedPoints;
  if (typeof projected === 'number' && Number.isFinite(projected) && projected > 0) {
    facts.push({ text: `Projects ${String(Math.round(projected))} pts`, basis: 'Projected season fantasy points in your scoring.' });
  }
  const rank = recommendation.diagnostics?.expertRank ?? player?.ecrRank;
  if (typeof rank === 'number' && Number.isFinite(rank) && rank > 0) {
    facts.push({ text: `Expert rank #${String(Math.round(rank))}`, basis: 'Where the expert consensus rankings place this player overall.' });
  }
  return facts;
}

const SUMMARY_PARTS = 2;
const joinSummary = (parts: readonly PlainSuggestionSummary[]): PlainSuggestionSummary | null => parts.length > 0
  ? { text: parts.map((part) => part.text).join(' · '), basis: parts.map((part) => part.basis).join(' ') }
  : null;

export function getPlainSuggestionSummaryParts(input: Parameters<typeof getSuggestionSummaryCandidates>[0]): PlainSuggestionSummary | null {
  return joinSummary(getSuggestionSummaryCandidates(input).slice(0, SUMMARY_PARTS));
}

/**
 * Each card's line, chosen across all the cards so every line states at least one fact no other card's line does.
 * A card keeps its first two facts when one of them is its own. Otherwise (late kickers that are all "Even with #1 ·
 * Next K tier −11 pts", or near-zero cards at one position sharing an open slot and a run) its second fact makes way
 * for one no other line states: preferably one no other card could state at all (its own projected points or expert
 * rank), else a later comparison fact. A fact
 * added this way is unique among the lines, so it never takes uniqueness away from a card already settled.
 */
export function separateSuggestionSummaries(cards: readonly {
  readonly playerId: string;
  readonly candidates: readonly PlainSuggestionSummary[];
  readonly extras: readonly PlainSuggestionSummary[];
}[]): ReadonlyMap<string, PlainSuggestionSummary | null> {
  const shown = cards.map((card) => card.candidates.slice(0, SUMMARY_PARTS));
  const othersShown = (index: number): string[] => shown.flatMap((parts, other) => other === index ? [] : parts.map((part) => part.text));
  // Facts any other card could state: a fact outside this set is this player's alone (his own points or rank).
  const othersPossible = (index: number): Set<string> => new Set(cards.flatMap((card, other) => other === index ? [] : [...card.candidates, ...card.extras].map((part) => part.text)));
  const hasOwnFact = (index: number): boolean => {
    const others = othersShown(index);
    return (shown[index] ?? []).some((part) => !others.includes(part.text));
  };
  // Decided on the first lines, before any changes, so a card does not count a shared fact as its own just because
  // the cards before it swapped that fact out.
  const needsOwnFact = cards.map((_, index) => cards.length > 1 && !hasOwnFact(index));
  const settle = (card: (typeof cards)[number], index: number): void => {
    const others = othersShown(index);
    const own = shown[index] ?? [];
    const pool = [...card.candidates.slice(SUMMARY_PARTS), ...card.extras].filter((part) => !others.includes(part.text) && !own.some((kept) => kept.text === part.text));
    const possible = othersPossible(index);
    const unique = pool.find((part) => !possible.has(part.text)) ?? pool[0];
    // The lead fact stays (it is the most telling about the pick); the second makes way.
    if (unique) shown[index] = [...own.slice(0, SUMMARY_PARTS - 1), unique];
  };
  cards.forEach((card, index) => { if (needsOwnFact[index]) settle(card, index); });
  // A fact added above is unique among the lines, so this only catches a card left without one of its own.
  cards.forEach((card, index) => { if (cards.length > 1 && !hasOwnFact(index)) settle(card, index); });
  return new Map(cards.map((card, index) => [card.playerId, joinSummary(shown[index] ?? [])]));
}

export function getPlainSuggestionSummary(input: Parameters<typeof getPlainSuggestionSummaryParts>[0]): string | null {
  return getPlainSuggestionSummaryParts(input)?.text ?? null;
}
