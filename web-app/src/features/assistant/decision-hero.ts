import { DECISION_LENSES, formatSignedNumber, type DecisionDivergenceFactor, type DecisionLens, type DecisionOutput, type PositionNeed, type Recommendation } from '@fantasy-draft/shared/draft';
import type { Position } from '@fantasy-draft/shared/league';
import type { NextPickAvailability } from '@/lib/next-pick-availability';

const plural = (count: number, word: string): string => `${String(count)} ${word}${count === 1 ? '' : 's'}`;

/** The player's value over a fill-in starter: the guarded figure every other surface shows, so the two never differ. */
function heroValueOverReplacement(recommendation: Recommendation): number | undefined {
  const vor = recommendation.diagnostics?.valueOverReplacement ?? recommendation.decisionFactors?.leagueValue.valueOverReplacement;
  return typeof vor === 'number' && Number.isFinite(vor) ? vor : undefined;
}

/** Best Pick's factors in the decision bar's order: the divergence factor, then each that moved the pick. */
function decidingFactors(recommendation: Recommendation, divergenceFactor: DecisionDivergenceFactor | null): readonly DecisionDivergenceFactor[] {
  const factors = recommendation.decisionFactors;
  if (!factors) return [];
  const moved: [DecisionDivergenceFactor, boolean | undefined][] = [
    ['draft-timing', factors.draftTiming.materiallyChangedOrdering],
    ['tier-supply', factors.tierSupply.materiallyChangedOrdering],
    ['depth-value', factors.depthValue.materiallyChangedOrdering],
    ['roster-fit', factors.rosterFit.materiallyChangedOrdering],
    ['league-value', factors.leagueValue.materiallyChangedOrdering],
  ];
  const order = moved.filter(([, changed]) => changed === true).map(([factor]) => factor);
  return divergenceFactor ? [divergenceFactor, ...order.filter((factor) => factor !== divergenceFactor)] : order;
}

/** "Fills your open WR starting spot", only when the pick's own position (or a FLEX it can fill) has an open starter slot. */
function describeOpenSlot(position: Position, need: PositionNeed | undefined): string | null {
  if (!need) return null;
  const fixed = Math.max(0, need.startersNeeded - need.startersFilled);
  if (fixed > 0) return fixed === 1 ? `Fills your open ${position} starting spot` : `Fills one of your ${String(fixed)} open ${position} starting spots`;
  const flex = need.isFlexEligible ? Math.max(0, need.flexSlotsNeeded - need.flexSlotsFilled) : 0;
  if (flex > 0) return flex === 1 ? 'Fills your open FLEX spot' : `Fills one of your ${String(flex)} open FLEX spots`;
  return null;
}

/**
 * The call's one reason, in plain words, from the same figures as the lens's why-text: Ranked Fit and Best Player
 * rank by the rankings alone (Ranked Fit only among players who keep a legal roster possible), so their line is the
 * rank; Best Pick's line is the first factor that decided it (the decision bar's order) that holds for this player.
 */
export function getHeroReason(
  recommendation: Recommendation,
  lens: DecisionLens,
  divergenceFactor: DecisionDivergenceFactor | null = null,
  /** The team's need at the pick's position: a roster-fit reason must name a slot this player can fill. */
  need?: PositionNeed
): string {
  const factors = recommendation.decisionFactors;
  const rank = recommendation.diagnostics?.expertRank ?? factors?.playerQuality.ecrRank;
  const overall = typeof rank === 'number' ? `#${String(rank)} overall` : null;
  if (lens === 'ranked-fit') return `Highest-ranked player who still fits your roster${overall ? `, ${overall}` : ''}`;
  if (lens === 'best-player') return `Highest-ranked player left on the board${overall ? `, ${overall}` : ''}`;

  const position = recommendation.position;
  const vor = heroValueOverReplacement(recommendation);
  const value = vor === undefined ? null : `${formatSignedNumber(Math.round(vor))} points over a fill-in ${position}`;
  const fallback = value ? `Projects ${value}${overall ? `, ${overall}` : ''}` : `Best Pick's top choice${overall ? `, ${overall}` : ''}`;
  if (!factors) return fallback;
  if (factors.conservativeBoundary.feasibilityException) {
    return `Keeps your roster fillable with ${plural(factors.rosterFit.selectionsRemaining, 'pick')} left`;
  }
  for (const factor of decidingFactors(recommendation, divergenceFactor)) {
    switch (factor) {
      case 'draft-timing': {
        const at = factors.draftTiming.nextPickLabel;
        return `Waiting${at ? ` until ${at}` : ''} costs about ${plural(Math.round(factors.draftTiming.costOfWaiting), 'point')}`;
      }
      case 'tier-supply': {
        const { remainingInTier, currentTier } = factors.tierSupply;
        const drop = `a ${String(Math.round(factors.tierSupply.dropoffPoints))}-point drop`;
        return remainingInTier === 1
          ? `Last ${position} in Tier ${String(currentTier)} before ${drop}`
          : `Only ${plural(remainingInTier, position)} left in Tier ${String(currentTier)} before ${drop}`;
      }
      case 'roster-fit': {
        const slot = describeOpenSlot(position, need);
        if (slot) return slot;
        break;
      }
      case 'depth-value':
        return `Adds ${position} depth: you have ${String(factors.depthValue.reserveCount)} of ${String(factors.depthValue.targetReserveCount)} backups`;
      case 'league-value':
        if (value) return `Projects ${value} in your scoring`;
        break;
    }
  }
  return fallback;
}

/** The skip row's lead-in: a choice only on the clock; while waiting, just who should last to your pick. */
export function getSkipRowLabel(position: Position, pickLabel: string, onClock: boolean): string {
  return onClock ? `Skip ${position} now? Still there at ${pickLabel}:` : `Likely there at ${pickLabel}:`;
}

/** The top pick of each lens, as the decision output names them. */
function lensLeader(output: Pick<DecisionOutput, 'rankedFit' | 'bestPick' | 'bestPlayer'>, lens: DecisionLens): Recommendation | null {
  if (lens === 'ranked-fit') return output.rankedFit;
  if (lens === 'best-pick') return output.bestPick;
  return output.bestPlayer;
}

/**
 * The one other lens worth offering beside the call: the first lens, in toggle order, whose top pick is someone
 * else. Null when every lens agrees (the hero then offers Compare instead).
 */
export function getDisagreeingLens(
  output: Pick<DecisionOutput, 'rankedFit' | 'bestPick' | 'bestPlayer'>,
  lens: DecisionLens
): { readonly lens: DecisionLens; readonly recommendation: Recommendation } | null {
  const current = lensLeader(output, lens);
  for (const other of DECISION_LENSES) {
    if (other === lens) continue;
    const leader = lensLeader(output, other);
    if (leader && leader.playerId !== current?.playerId) return { lens: other, recommendation: leader };
  }
  return null;
}

const NAME_SUFFIXES = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'v']);

/** "Draft Harrison" for Marvin Harrison Jr.; a defense keeps its whole name. */
export function shortPlayerName(name: string, position?: Position): string {
  if (position === 'DEF') return name;
  const parts = name.trim().split(/\s+/);
  while (parts.length > 1 && NAME_SUFFIXES.has((parts[parts.length - 1] ?? '').toLowerCase())) parts.pop();
  return parts[parts.length - 1] ?? name;
}

export interface HeroStat {
  readonly key: 'gone' | 'value' | 'tier';
  readonly value: string;
  readonly label: string;
  readonly title: string;
  /** The gone-by figure reads as urgent once the player is more likely gone than not. */
  readonly urgent?: boolean;
}

/** Up to three facts under the call, each from the model's own figures; a fact without data is left out. */
export function getHeroStats(recommendation: Recommendation, availability: NextPickAvailability): readonly HeroStat[] {
  const stats: HeroStat[] = [];
  const diagnostics = recommendation.diagnostics;
  if (availability.kind === 'estimate') {
    const gone = Math.round((1 - availability.probability) * 100);
    const at = availability.pickLabel ?? 'your next pick';
    stats.push({
      key: 'gone',
      value: `${String(gone)}%`,
      label: `gone by ${at}`,
      title: `Estimated chance ${recommendation.playerName} is drafted before ${at}. An estimate, not a guarantee.`,
      urgent: gone >= 50,
    });
  }
  const vor = heroValueOverReplacement(recommendation);
  if (vor !== undefined) {
    stats.push({
      key: 'value',
      value: formatSignedNumber(Math.round(vor)),
      label: 'over fill-in',
      title: `Projected points over a fill-in ${recommendation.position} starter.`,
    });
  }
  if (diagnostics && typeof diagnostics.tier === 'number') {
    const left = diagnostics.tierRemaining;
    stats.push({
      key: 'tier',
      value: `Tier ${String(diagnostics.tier)}`,
      label: typeof left === 'number' ? `${String(left)} ${recommendation.position}${left === 1 ? '' : 's'} left` : recommendation.position,
      title: typeof left === 'number'
        ? `${String(left)} available ${recommendation.position}${left === 1 ? '' : 's'} left in ${recommendation.position} Tier ${String(diagnostics.tier)}, ${recommendation.playerName} included.`
        : `${recommendation.position} Tier ${String(diagnostics.tier)}.`,
    });
  }
  return stats;
}

/** At least this chance of lasting to the next pick counts as "likely still there". */
export const LIKELY_AVAILABLE = 0.5;
const SKIP_ROW_PLAYERS = 3;

export interface SkipRow {
  readonly position: Position;
  readonly players: readonly { readonly playerId: string; readonly playerName: string; readonly probability: number }[];
}

/**
 * "Skip RB now? Still there at 6.06:" — the position the call passes on (the best-ranked other position in this
 * lens), and its best players in this lens's order who are likely to last to the next pick. Null without a
 * survival estimate, so the row never invents availability.
 */
export function getSkipRow({ hero, ranked, byPosition, availabilityById }: {
  readonly hero: Recommendation;
  /** The lens's overall order. */
  readonly ranked: readonly Recommendation[];
  /** The lens's order within each position. */
  readonly byPosition: Readonly<Partial<Record<Position, readonly Recommendation[]>>>;
  readonly availabilityById: ReadonlyMap<string, NextPickAvailability>;
}): SkipRow | null {
  const position = ranked.find((recommendation) => recommendation.position !== hero.position)?.position;
  if (!position) return null;
  const players = (byPosition[position] ?? []).flatMap((recommendation) => {
    const availability = availabilityById.get(recommendation.playerId);
    return availability?.kind === 'estimate' && availability.probability >= LIKELY_AVAILABLE
      ? [{ playerId: recommendation.playerId, playerName: recommendation.playerName, probability: availability.probability }]
      : [];
  }).slice(0, SKIP_ROW_PLAYERS);
  return players.length > 0 ? { position, players } : null;
}
