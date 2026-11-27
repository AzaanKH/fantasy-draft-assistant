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
  /** Offensive positions the FLEX slots accept. */
  readonly flexPositions: readonly OffensivePosition[];
  readonly totalOffensiveSlots: number;
}

export type OffensiveRosterCounts = Readonly<Record<OffensivePosition, number>>;

/**
 * Derive offensive roster rules from provider roster slot labels such as `QB`, `FLEX` and `BN`.
 * Historical league files label every FLEX slot `FLEX`, so these rules use standard FLEX (RB, WR, TE).
 */
export function deriveRosterRules(rosterPositions: readonly string[]): RosterRules {
  const fixedStarters: Record<OffensivePosition, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  for (const position of OFFENSIVE_POSITIONS) {
    fixedStarters[position] = rosterPositions.filter((slot) => slot === position).length;
  }
  const flexStarters = rosterPositions.filter((slot) => slot === 'FLEX').length;
  return {
    fixedStarters,
    flexStarters,
    flexPositions: FLEX_GROUPS.standard,
    totalOffensiveSlots:
      Object.values(fixedStarters).reduce((sum, count) => sum + count, 0) +
      flexStarters +
      rosterPositions.filter((slot) => slot === 'BN').length,
  };
}

/**
 * Offensive roster rules from the app's roster requirements, with the league's own FLEX eligibility
 * (superflex accepts QBs; a receiving-only FLEX rejects RBs). K and DEF are handled separately.
 */
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
    flexPositions: OFFENSIVE_POSITIONS.filter((position) => requirements.FLEX.eligiblePositions.includes(position)),
    totalOffensiveSlots: fixed + requirements.FLEX.starters + requirements.BENCH.spots,
  };
}

export function flexEligibleCount(counts: OffensiveRosterCounts, rules: RosterRules): number {
  return rules.flexPositions.reduce((sum, position) => sum + counts[position], 0);
}

export function flexTarget(rules: RosterRules): number {
  return rules.flexPositions.reduce((sum, position) => sum + rules.fixedStarters[position], 0) + rules.flexStarters;
}

export function isFlexPosition(position: OffensivePosition, rules: RosterRules): boolean {
  return rules.flexPositions.includes(position);
}

/**
 * Starting slots (fixed plus FLEX) the roster still has to fill. Only a FLEX-eligible player beyond
 * their own position's fixed starters fills FLEX, so an open fixed slot never counts as FLEX too.
 */
export function missingRequiredSlots(counts: OffensiveRosterCounts, rules: RosterRules): number {
  const missingFixed = OFFENSIVE_POSITIONS.reduce(
    (sum, position) => sum + Math.max(0, rules.fixedStarters[position] - counts[position]),
    0
  );
  const surplusFlex = rules.flexPositions.reduce(
    (sum, position) => sum + Math.max(0, counts[position] - rules.fixedStarters[position]),
    0
  );
  return missingFixed + Math.max(0, rules.flexStarters - surplusFlex);
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
  // No selection left for an offensive player (every remaining one is reserved for K or DEF).
  if (remainingPicksIncludingCurrent <= 0) return false;
  const rosterSize = OFFENSIVE_POSITIONS.reduce((sum, item) => sum + counts[item], 0);
  if (rosterSize >= rules.totalOffensiveSlots) return false;
  if (counts[position] >= maximums[position]) return false;
  const after = { ...counts, [position]: counts[position] + 1 };
  return missingRequiredSlots(after, rules) <= Math.max(0, remainingPicksIncludingCurrent - 1);
}

export interface RankedFitInput<Player> {
  readonly position: (player: Player) => OffensivePosition;
  readonly expertRank: (player: Player) => number;
  /** Name and ID break expert-rank ties, so every caller orders a tied pool the same way. */
  readonly name: (player: Player) => string;
  readonly id: (player: Player) => string;
  readonly counts: OffensiveRosterCounts;
  readonly rules: RosterRules;
  /** Manager selections left, including the current selection. */
  readonly remainingPicksIncludingCurrent: number;
  readonly maximums?: Readonly<Record<OffensivePosition, number>>;
}

/** Ascending expert rank, then name, then ID: the one Ranked Fit tie rule. */
function compareRankedFit<Player>(
  input: Pick<RankedFitInput<Player>, 'expertRank' | 'name' | 'id'>
): (a: Player, b: Player) => number {
  return (a, b) =>
    input.expertRank(a) - input.expertRank(b) ||
    input.name(a).localeCompare(input.name(b)) ||
    input.id(a).localeCompare(input.id(b));
}

/**
 * Ranked Fit order: legal candidates by ascending expert rank, ties by name then ID.
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
    .sort(compareRankedFit(input));
}

function isOffensive(position: Position): position is OffensivePosition {
  return OFFENSIVE_POSITIONS.some((item) => item === position);
}

type LivePlayer = { readonly id: string; readonly name: string; readonly position: Position; readonly ecrRank: number };

const LIVE_ACCESSORS = {
  expertRank: (player: LivePlayer) => player.ecrRank,
  name: (player: LivePlayer) => player.name,
  id: (player: LivePlayer) => player.id,
};

export interface LiveRankedFitContext {
  readonly requirements?: RosterRequirements;
  readonly rosterCounts?: Readonly<Partial<Record<Position, number>>>;
  readonly selectionsRemaining?: number;
}

/**
 * Apply Ranked Fit to the live player pool, which also holds K and DEF. Open K and DEF
 * starting slots reserve that many selections, so offensive legality sees only the rest.
 * A K or DEF is legal while its starting slot is open and the selections left still cover
 * every open offensive starter. Legal K and DEF list after every legal offensive player,
 * so they lead once only reserved selections remain. Without roster requirements the order
 * is plain ECR.
 */
export function orderLiveRankedFit<Player extends LivePlayer>(
  available: readonly Player[],
  context: LiveRankedFitContext | undefined
): Player[] {
  const byRank = compareRankedFit<Player>(LIVE_ACCESSORS);
  const requirements = context?.requirements;
  if (!requirements) return [...available].sort(byRank);
  const count = (position: Position): number => context.rosterCounts?.[position] ?? 0;
  const remaining = context.selectionsRemaining ?? Number.MAX_SAFE_INTEGER;
  const reserved = KICKER_DEFENSE_POSITIONS.reduce(
    (sum, position) => sum + Math.max(0, requirements[position].starters - count(position)),
    0
  );
  const rules = rosterRulesFromRequirements(requirements);
  const counts = { QB: count('QB'), RB: count('RB'), WR: count('WR'), TE: count('TE') };
  const offensive = orderRankedFit(
    available.filter((player): player is Player & { readonly position: OffensivePosition } => isOffensive(player.position)),
    {
      ...LIVE_ACCESSORS,
      position: (player) => player.position,
      counts,
      rules,
      remainingPicksIncludingCurrent: remaining - reserved,
      maximums: {
        QB: requirements.QB.max,
        RB: requirements.RB.max,
        WR: requirements.WR.max,
        TE: requirements.TE.max,
      },
    }
  );
  const specialTeamsFit = remaining >= 1 && missingRequiredSlots(counts, rules) <= remaining - reserved;
  const specialTeams = specialTeamsFit
    ? available
      .filter((player) => !isOffensive(player.position) &&
        count(player.position) < Math.min(requirements[player.position].starters, requirements[player.position].max))
      .sort(byRank)
    : [];
  return [...offensive, ...specialTeams];
}
