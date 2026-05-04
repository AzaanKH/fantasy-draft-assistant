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

/**
 * Priority order for sorting needs (lower index = higher priority)
 */
const PRIORITY_ORDER: Record<NeedPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  filled: 4,
};

/**
 * Calculate team positional needs based on current roster and scarcity
 *
 * Priority levels:
 * - critical: No players at a position that requires starters
 * - high: Below starter count AND scarcity >= 7
 * - medium: Below starter count with lower scarcity
 * - low: Have starters but below max roster
 * - filled: At max roster for position
 *
 * @param roster - Current team roster
 * @param requirements - League roster requirements
 * @param scarcityScores - Map of position to scarcity score (1-10)
 * @returns Array of position needs sorted by priority
 *
 * @example
 * const needs = calculateTeamNeeds(myRoster, DEFAULT_ROSTER_REQUIREMENTS, scarcityMap);
 * // Returns: [{ position: 'RB', priority: 'critical', ... }, ...]
 */
export function calculateTeamNeeds(
  roster: Roster,
  requirements: RosterRequirements,
  scarcityScores: Map<Position, number>
): PositionNeed[] {
  const needs: PositionNeed[] = [];
  const positions: Position[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

  for (const position of positions) {
    const filled = roster[position].length;
    const needed = requirements[position].starters;
    const max = requirements[position].max;
    const scarcity = scarcityScores.get(position) ?? 5;

    let priority: NeedPriority;

    if (filled === 0 && needed > 0) {
      // No players at position that needs starters
      priority = 'critical';
    } else if (filled < needed) {
      // Below starter count - priority depends on scarcity
      priority = scarcity >= 7 ? 'high' : 'medium';
    } else if (filled < max) {
      // Have starters but room for bench depth
      priority = 'low';
    } else {
      // At max roster for position
      priority = 'filled';
    }

    needs.push({
      position,
      priority,
      startersFilled: Math.min(filled, needed),
      startersNeeded: needed,
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
  return need !== undefined && need.priority !== 'low' && need.priority !== 'filled';
}
