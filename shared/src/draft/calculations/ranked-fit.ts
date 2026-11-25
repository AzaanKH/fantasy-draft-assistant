import {
  FLEX_GROUPS,
  KICKER_DEFENSE_POSITIONS,
  OFFENSIVE_POSITIONS,
  type OffensivePosition,
  type Position,
} from '../../league/positions.js';
import type { RosterRequirements } from '../../draft.js';

/**
 * Ranked Fit: the ECR Anchor order restricted to players who keep a legal completed
 * roster possible. The recommendation backtest's "Roster-aware ECR" row calls
 * {@link orderRankedFit} directly, so what the backtest measures is what the lens shows.
 */

/** Roster rules count only standard FLEX slots (RB, WR, TE). */
const FLEX_POSITIONS: readonly OffensivePosition[] = FLEX_GROUPS.standard;

/** Backtest roster maximums; the live lens passes the league's own maximums instead. */
export const POSITION_MAXIMUMS: Readonly<Record<OffensivePosition, number>> = {
  QB: 4,
  RB: 8,
  WR: 8,
  TE: 3,
};

export interface RosterRules {
  readonly fixedStarters: Record<OffensivePosition, number>;
  readonly flexStarters: number;
  readonly totalOffensiveSlots: number;
}

export type OffensiveRosterCounts = Readonly<Record<OffensivePosition, number>>;

/** Derive offensive roster rules from provider roster slot labels such as `QB`, `FLEX` and `BN`. */
export function deriveRosterRules(rosterPositions: readonly string[]): RosterRules {
  const fixedStarters: Record<OffensivePosition, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  for (const position of OFFENSIVE_POSITIONS) {
    fixedStarters[position] = rosterPositions.filter((slot) => slot === position).length;
  }
  const flexStarters = rosterPositions.filter((slot) => slot === 'FLEX').length;
  return {
    fixedStarters,
    flexStarters,
    totalOffensiveSlots:
      Object.values(fixedStarters).reduce((sum, count) => sum + count, 0) +
      flexStarters +
      rosterPositions.filter((slot) => slot === 'BN').length,
  };
}

/** Offensive roster rules from the app's roster requirements. K and DEF are handled separately. */
export function rosterRulesFromRequirements(requirements: RosterRequirements): RosterRules {
  const fixedStarters: Record<OffensivePosition, number> = {
    QB: requirements.QB.starters,
    RB: requirements.RB.starters,
    WR: requirements.WR.starters,
    TE: requirements.TE.starters,
  };
  const fixed = Object.values(fixedStarters).reduce((sum, count) => sum + count, 0);
  return {
    fixedStarters,
    flexStarters: requirements.FLEX.starters,
    totalOffensiveSlots: fixed + requirements.FLEX.starters + requirements.BENCH.spots,
  };
}

export function flexEligibleCount(counts: OffensiveRosterCounts): number {
  return FLEX_POSITIONS.reduce((sum, position) => sum + counts[position], 0);
}

function fixedFlexStarters(rules: RosterRules): number {
  return FLEX_POSITIONS.reduce((sum, position) => sum + rules.fixedStarters[position], 0);
}

export function flexTarget(rules: RosterRules): number {
  return fixedFlexStarters(rules) + rules.flexStarters;
}

export function isFlexPosition(position: OffensivePosition): boolean {
  return FLEX_POSITIONS.includes(position);
}

/** Starting slots (fixed plus FLEX) the roster still has to fill. */
export function missingRequiredSlots(counts: OffensiveRosterCounts, rules: RosterRules): number {
  const missingFixed = OFFENSIVE_POSITIONS.reduce(
    (sum, position) => sum + Math.max(0, rules.fixedStarters[position] - counts[position]),
    0
  );
  const fixedFlexBase = fixedFlexStarters(rules);
  const filledFlex = Math.min(rules.flexStarters, Math.max(0, flexEligibleCount(counts) - fixedFlexBase));
  return missingFixed + Math.max(0, rules.flexStarters - filledFlex);
}

/**
 * Whether drafting a player at this position still leaves enough selections to fill every
 * starting slot, without exceeding the roster size or the position maximum.
 */
export function isRankedFitLegal(
  position: OffensivePosition,
  counts: OffensiveRosterCounts,
  rules: RosterRules,
  remainingPicksIncludingCurrent: number,
  maximums: Readonly<Record<OffensivePosition, number>> = POSITION_MAXIMUMS
): boolean {
  const rosterSize = OFFENSIVE_POSITIONS.reduce((sum, item) => sum + counts[item], 0);
  if (rosterSize >= rules.totalOffensiveSlots) return false;
  if (counts[position] >= maximums[position]) return false;
  const after = { ...counts, [position]: counts[position] + 1 };
  return missingRequiredSlots(after, rules) <= Math.max(0, remainingPicksIncludingCurrent - 1);
}

export interface RankedFitInput<Player> {
  readonly position: (player: Player) => OffensivePosition;
  readonly expertRank: (player: Player) => number;
  readonly counts: OffensiveRosterCounts;
  readonly rules: RosterRules;
  /** Manager selections left, including the current selection. */
  readonly remainingPicksIncludingCurrent: number;
  readonly maximums?: Readonly<Record<OffensivePosition, number>>;
}

/**
 * Ranked Fit order: legal candidates by ascending expert rank. Ties keep input order.
 * There is no surplus-starter demotion: a backup QB keeps its ECR place while it is legal.
 */
export function orderRankedFit<Player>(
  available: readonly Player[],
  input: RankedFitInput<Player>
): Player[] {
  return [...available]
    .filter((candidate) => isRankedFitLegal(
      input.position(candidate),
      input.counts,
      input.rules,
      input.remainingPicksIncludingCurrent,
      input.maximums
    ))
    .sort((a, b) => input.expertRank(a) - input.expertRank(b));
}

function isOffensive(position: Position): position is OffensivePosition {
  return OFFENSIVE_POSITIONS.some((item) => item === position);
}

export interface LiveRankedFitContext {
  readonly requirements?: RosterRequirements;
  readonly rosterCounts?: Readonly<Partial<Record<Position, number>>>;
  readonly selectionsRemaining?: number;
}

/**
 * Apply Ranked Fit to the live player pool, which also holds K and DEF. Open K and DEF
 * starting slots reserve that many selections, so offensive legality sees only the rest.
 * K and DEF list after every legal offensive player, and first once only reserved
 * selections remain. Without roster requirements the order is plain ECR.
 */
export function orderLiveRankedFit<Player extends { readonly position: Position; readonly ecrRank: number }>(
  available: readonly Player[],
  context: LiveRankedFitContext | undefined
): Player[] {
  const byRank = (a: Player, b: Player): number => a.ecrRank - b.ecrRank;
  const requirements = context?.requirements;
  if (!requirements) return [...available].sort(byRank);
  const count = (position: Position): number => context.rosterCounts?.[position] ?? 0;
  const remaining = context.selectionsRemaining ?? Number.MAX_SAFE_INTEGER;
  const reserved = KICKER_DEFENSE_POSITIONS.reduce(
    (sum, position) => sum + Math.max(0, requirements[position].starters - count(position)),
    0
  );
  const offensive = orderRankedFit(
    available.filter((player): player is Player & { readonly position: OffensivePosition } => isOffensive(player.position)),
    {
      position: (player) => player.position,
      expertRank: (player) => player.ecrRank,
      counts: { QB: count('QB'), RB: count('RB'), WR: count('WR'), TE: count('TE') },
      rules: rosterRulesFromRequirements(requirements),
      remainingPicksIncludingCurrent: remaining - reserved,
      maximums: {
        QB: requirements.QB.max,
        RB: requirements.RB.max,
        WR: requirements.WR.max,
        TE: requirements.TE.max,
      },
    }
  );
  const specialTeams = available
    .filter((player) => !isOffensive(player.position) &&
      count(player.position) < Math.min(requirements[player.position].starters, requirements[player.position].max))
    .sort(byRank);
  return remaining <= reserved || offensive.length === 0
    ? [...specialTeams, ...offensive]
    : [...offensive, ...specialTeams];
}
