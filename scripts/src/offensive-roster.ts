import { OFFENSIVE_POSITIONS, type OffensivePosition } from '@fantasy-draft/shared/league';
import {
  deriveRosterRules,
  flexEligibleCount,
  flexTarget,
  isFlexPosition,
  isRankedFitLegal,
  missingRequiredSlots as missingRequiredSlotsForCounts,
  POSITION_MAXIMUMS,
  type OffensiveRosterCounts,
  type RosterRules,
} from '@fantasy-draft/shared/draft';

const REDUNDANT_SINGLE_STARTER_MULTIPLIERS: Readonly<Record<'QB' | 'TE', number>> = {
  QB: 0.2,
  TE: 0.45,
};
const FIXED_NEED_BONUS = 34;
const FLEX_NEED_BONUS = 12;

export { deriveRosterRules, POSITION_MAXIMUMS, type RosterRules };

export type OffensiveRoster<Player> = Record<OffensivePosition, Player[]>;

export function createOffensiveRoster<Player>(): OffensiveRoster<Player> {
  return { QB: [], RB: [], WR: [], TE: [] };
}

export function rosterCounts<Player>(roster: OffensiveRoster<Player>): OffensiveRosterCounts {
  return { QB: roster.QB.length, RB: roster.RB.length, WR: roster.WR.length, TE: roster.TE.length };
}

export function missingRequiredSlots<Player>(
  roster: OffensiveRoster<Player>,
  rules: RosterRules
): number {
  return missingRequiredSlotsForCounts(rosterCounts(roster), rules);
}

export function isLegalCandidate<Player extends { position: OffensivePosition }>(
  candidate: Player,
  roster: OffensiveRoster<Player>,
  rules: RosterRules,
  remainingPicksIncludingCurrent: number
): boolean {
  return isRankedFitLegal(candidate.position, rosterCounts(roster), rules, remainingPicksIncludingCurrent);
}

export function rosterAdjustedValue<Player extends { position: OffensivePosition }>(
  candidate: Player,
  valueOverReplacement: number,
  roster: OffensiveRoster<Player>,
  rules: RosterRules
): number {
  const fixedNeed = roster[candidate.position].length < rules.fixedStarters[candidate.position];
  const flexEligible = isFlexPosition(candidate.position, rules);
  const flexNeed = flexEligible && flexEligibleCount(rosterCounts(roster), rules) < flexTarget(rules);
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
