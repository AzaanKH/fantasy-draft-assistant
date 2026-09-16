/**
 * Team needs calculation
 *
 * Evaluates which positions a team needs to fill
 * based on roster requirements and positional scarcity.
 */

import type {
  Position,
  Roster,
  RosterRequirements,
  PositionNeed,
  NeedPriority,
} from '@fantasy-draft/shared';
import {
  getDraftProgress,
  isSpecialTeamsPosition,
  shouldDeferSpecialTeams,
  type DraftStageContext,
} from './draft-stage';

/**
 * Priority order for sorting needs (lower index = higher priority)
 */
const PRIORITY_ORDER: Record<NeedPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  defer: 4,
  filled: 5,
};

const HIGH_SCARCITY_SCORE = 7;
const MID_DRAFT_PROGRESS = 0.5;

/**
 * Calculate team positional needs based on current roster and scarcity
 *
 * Priority levels:
 * - critical: Empty position under starter-slot, scarcity, or draft-stage pressure
 * - high: Open fixed/FLEX starter slot with elevated scarcity or draft-stage pressure
 * - medium: Open fixed/FLEX starter slot with lower scarcity
 * - low: Fixed and FLEX starters are covered, but there is room for bench depth
 * - defer: Kicker or defense before the late rounds
 * - filled: At max roster for position
 *
 * @param roster - Current team roster
 * @param requirements - League roster requirements
 * @param scarcityScores - Map of position to scarcity score (1-10)
 * @param context - Current draft stage
 * @returns Array of position needs sorted by priority
 *
 * @example
 * const needs = calculateTeamNeeds(
 *   myRoster,
 *   DEFAULT_ROSTER_REQUIREMENTS,
 *   scarcityMap,
 *   context
 * );
 * // Returns: [{ position: 'RB', priority: 'critical', ... }, ...]
 */
export function calculateTeamNeeds(
  roster: Roster,
  requirements: RosterRequirements,
  scarcityScores: Map<Position, number>,
  context?: DraftStageContext
): PositionNeed[] {
  const needs: PositionNeed[] = [];
  const positions: Position[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
  const isOpeningBoard = context?.currentPick === 1;
  const draftProgress = getDraftProgress(context);
  const isMidDraft = draftProgress >= MID_DRAFT_PROGRESS;
  const flexEligiblePositions = new Set(requirements.FLEX.eligiblePositions);
  const flexSlotsNeeded = Math.max(0, requirements.FLEX.starters);
  const fixedStarterSlotsRemaining = positions.reduce(
    (total, position) =>
      total + Math.max(0, requirements[position].starters - roster[position].length),
    0
  );
  const flexEligibleSurplus = [...flexEligiblePositions].reduce(
    (total, position) =>
      total + Math.max(0, roster[position].length - requirements[position].starters),
    0
  );
  const flexSlotsFilled = Math.min(
    flexSlotsNeeded,
    flexEligibleSurplus
  );
  const flexSlotsRemaining = flexSlotsNeeded - flexSlotsFilled;
  const totalStarterSlotsRemaining =
    fixedStarterSlotsRemaining + flexSlotsRemaining;
  const estimatedRosterPicksRemaining = context?.totalRounds
    ? Math.max(0, Math.ceil((1 - draftProgress) * context.totalRounds))
    : Number.POSITIVE_INFINITY;
  const isStarterSlotCrunch = totalStarterSlotsRemaining >= estimatedRosterPicksRemaining;

  for (const position of positions) {
    const filled = roster[position].length;
    const needed = requirements[position].starters;
    const max = requirements[position].max;
    const scarcity = scarcityScores.get(position) ?? 5;
    const fixedStarterSlotsRemainingForPosition = Math.max(0, needed - filled);
    const isFlexEligible = flexEligiblePositions.has(position);
    const openFlexSlotsForPosition = isFlexEligible && filled < max
      ? flexSlotsRemaining
      : 0;
    const starterSlotsRemaining =
      fixedStarterSlotsRemainingForPosition + openFlexSlotsForPosition;

    let priority: NeedPriority;

    if (filled >= max) {
      priority = 'filled';
    } else if (
      starterSlotsRemaining > 0 &&
      isSpecialTeamsPosition(position) &&
      shouldDeferSpecialTeams(context)
    ) {
      priority = 'defer';
    } else if (
      isOpeningBoard &&
      starterSlotsRemaining > 0 &&
      !isSpecialTeamsPosition(position)
    ) {
      priority = 'critical';
    } else if (
      filled === 0 &&
      starterSlotsRemaining > 0 &&
      (
        starterSlotsRemaining > 1 ||
        scarcity >= HIGH_SCARCITY_SCORE ||
        isMidDraft ||
        isStarterSlotCrunch
      )
    ) {
      priority = 'critical';
    } else if (starterSlotsRemaining > 0) {
      priority = scarcity >= HIGH_SCARCITY_SCORE || isMidDraft || isStarterSlotCrunch
        ? 'high'
        : 'medium';
    } else {
      // Fixed and FLEX starters are covered, with room for bench depth.
      priority = 'low';
    }

    needs.push({
      position,
      priority,
      startersFilled: Math.min(filled, needed),
      startersNeeded: needed,
      flexSlotsFilled,
      flexSlotsNeeded,
      isFlexEligible,
      scarcityScore: scarcity,
    });
  }

  // Sort by priority (critical first, filled last)
  return needs.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
}

/**
 * Get positions with critical or high priority needs
 *
 * @param needs - Array of position needs
 * @returns Array of positions that need attention
 */
export function getCriticalPositions(needs: readonly PositionNeed[]): Position[] {
  return needs
    .filter((n) => n.priority === 'critical' || n.priority === 'high')
    .map((n) => n.position);
}

/**
 * Check if a specific position is a need
 *
 * @param needs - Array of position needs
 * @param position - Position to check
 * @returns True if position has critical, high, or medium priority
 */
export function isPositionNeed(
  needs: readonly PositionNeed[],
  position: Position
): boolean {
  const need = needs.find((n) => n.position === position);
  return (
    need !== undefined &&
    need.priority !== 'low' &&
    need.priority !== 'defer' &&
    need.priority !== 'filled'
  );
}
