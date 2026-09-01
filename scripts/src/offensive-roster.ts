import type { OffensivePosition } from './model/position-residual-model.js';

export const OFFENSIVE_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const;

export const POSITION_MAXIMUMS: Readonly<Record<OffensivePosition, number>> = {
  QB: 4,
  RB: 8,
  WR: 8,
  TE: 3,
};

const REDUNDANT_SINGLE_STARTER_MULTIPLIERS: Readonly<Record<'QB' | 'TE', number>> = {
  QB: 0.2,
  TE: 0.45,
};
const FIXED_NEED_BONUS = 34;
const FLEX_NEED_BONUS = 12;

export interface RosterRules {
  readonly fixedStarters: Record<OffensivePosition, number>;
  readonly flexStarters: number;
  readonly totalOffensiveSlots: number;
}

export type OffensiveRoster<Player> = Record<OffensivePosition, Player[]>;

export function createOffensiveRoster<Player>(): OffensiveRoster<Player> {
  return { QB: [], RB: [], WR: [], TE: [] };
}

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

function rosterSize<Player>(roster: OffensiveRoster<Player>): number {
  return OFFENSIVE_POSITIONS.reduce((sum, position) => sum + roster[position].length, 0);
}

function cloneRosterWith<Player extends { position: OffensivePosition }>(
  roster: OffensiveRoster<Player>,
  candidate: Player
): OffensiveRoster<Player> {
  return {
    QB: [...roster.QB, ...(candidate.position === 'QB' ? [candidate] : [])],
    RB: [...roster.RB, ...(candidate.position === 'RB' ? [candidate] : [])],
    WR: [...roster.WR, ...(candidate.position === 'WR' ? [candidate] : [])],
    TE: [...roster.TE, ...(candidate.position === 'TE' ? [candidate] : [])],
  };
}

function flexEligibleCount<Player>(roster: OffensiveRoster<Player>): number {
  return roster.RB.length + roster.WR.length + roster.TE.length;
}

function flexTarget(rules: RosterRules): number {
  return rules.fixedStarters.RB + rules.fixedStarters.WR + rules.fixedStarters.TE + rules.flexStarters;
}

export function missingRequiredSlots<Player>(
  roster: OffensiveRoster<Player>,
  rules: RosterRules
): number {
  const missingFixed = OFFENSIVE_POSITIONS.reduce(
    (sum, position) => sum + Math.max(0, rules.fixedStarters[position] - roster[position].length),
    0
  );
  const fixedFlexBase = rules.fixedStarters.RB + rules.fixedStarters.WR + rules.fixedStarters.TE;
  const filledFlex = Math.min(rules.flexStarters, Math.max(0, flexEligibleCount(roster) - fixedFlexBase));
  return missingFixed + Math.max(0, rules.flexStarters - filledFlex);
}

export function isLegalCandidate<Player extends { position: OffensivePosition }>(
  candidate: Player,
  roster: OffensiveRoster<Player>,
  rules: RosterRules,
  remainingPicksIncludingCurrent: number
): boolean {
  if (rosterSize(roster) >= rules.totalOffensiveSlots) return false;
  if (roster[candidate.position].length >= POSITION_MAXIMUMS[candidate.position]) return false;
  const after = cloneRosterWith(roster, candidate);
  return missingRequiredSlots(after, rules) <= Math.max(0, remainingPicksIncludingCurrent - 1);
}

export function rosterAdjustedValue<Player extends { position: OffensivePosition }>(
  candidate: Player,
  valueOverReplacement: number,
  roster: OffensiveRoster<Player>,
  rules: RosterRules
): number {
  const fixedNeed = roster[candidate.position].length < rules.fixedStarters[candidate.position];
  const flexEligible = candidate.position === 'RB' || candidate.position === 'WR' || candidate.position === 'TE';
  const flexNeed = flexEligible && flexEligibleCount(roster) < flexTarget(rules);
  const redundantMultiplier = candidate.position === 'QB' || candidate.position === 'TE'
    ? REDUNDANT_SINGLE_STARTER_MULTIPLIERS[candidate.position]
    : null;
  const redundantSingleStarter = redundantMultiplier !== null &&
    roster[candidate.position].length >= Math.max(1, rules.fixedStarters[candidate.position]);
  const adjustedValue = redundantSingleStarter
    ? valueOverReplacement * redundantMultiplier
    : valueOverReplacement;
  return adjustedValue + (fixedNeed ? FIXED_NEED_BONUS : 0) + (flexNeed ? FLEX_NEED_BONUS : 0);
}

export function calculateStarterPoints<Player extends { position: OffensivePosition }>(
  roster: OffensiveRoster<Player>,
  rules: RosterRules,
  getPlayerId: (player: Player) => string,
  getPlayerPoints: (player: Player) => number
): number {
  const used = new Set<string>();
  let points = 0;
  for (const position of OFFENSIVE_POSITIONS) {
    const starters = [...roster[position]]
      .sort((a, b) => getPlayerPoints(b) - getPlayerPoints(a))
      .slice(0, rules.fixedStarters[position]);
    for (const player of starters) {
      used.add(getPlayerId(player));
      points += getPlayerPoints(player);
    }
  }
  const flex = [...roster.RB, ...roster.WR, ...roster.TE]
    .filter((player) => !used.has(getPlayerId(player)))
    .sort((a, b) => getPlayerPoints(b) - getPlayerPoints(a))
    .slice(0, rules.flexStarters);
  return Number((points + flex.reduce((sum, player) => sum + getPlayerPoints(player), 0)).toFixed(2));
}
