import type { RosterRequirements } from './draft.js';
import type { Position } from './player.js';
import { POSITIONS } from './player.js';

export interface LineupPlayer {
  readonly id: string;
  readonly position: Position;
  readonly projectedPoints: number;
  readonly ceilingScore: number;
}

/** Maximum projected starter points permitted by the configured fixed and FLEX slots. */
export function optimizeLineupUtility(
  roster: readonly LineupPlayer[],
  requirements: RosterRequirements
): number {
  const used = new Set<string>();
  let utility = 0;

  for (const position of POSITIONS) {
    const fixed = roster
      .filter((player) => player.position === position)
      .sort((a, b) => b.projectedPoints - a.projectedPoints)
      .slice(0, requirements[position].starters);
    for (const player of fixed) {
      used.add(player.id);
      utility += player.projectedPoints;
    }
  }

  const flex = roster
    .filter((player) =>
      !used.has(player.id) && requirements.FLEX.eligiblePositions.includes(player.position)
    )
    .sort((a, b) => b.projectedPoints - a.projectedPoints)
    .slice(0, requirements.FLEX.starters);
  for (const player of flex) utility += player.projectedPoints;

  return utility;
}
