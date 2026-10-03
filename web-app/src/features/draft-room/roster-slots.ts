import type { Position, RosterRequirements } from '@fantasy-draft/shared';
import { POSITIONS } from '@fantasy-draft/shared';

type RosterSlotLabel = Position | 'FLEX' | 'BN';

export interface RosterSlot {
  readonly label: RosterSlotLabel;
  readonly playerId: string | null;
}

/**
 * Lays the drafted roster into lineup slots in Sleeper order: skill starters,
 * FLEX filled from eligible overflow, kicker and defense, then the bench.
 * Players beyond the bench allowance still appear on the bench so no drafted
 * player is hidden.
 */
export function getRosterSlots(
  roster: Readonly<Record<Position, readonly string[]>>,
  requirements: RosterRequirements
): RosterSlot[] {
  const startersByPosition = new Map<Position, RosterSlot[]>();
  const overflow: { readonly position: Position; readonly playerId: string }[] = [];

  for (const position of POSITIONS) {
    const playerIds = roster[position];
    const starterCount = requirements[position].starters;
    startersByPosition.set(position, Array.from({ length: starterCount }, (_, index) => ({
      label: position,
      playerId: playerIds[index] ?? null,
    })));
    for (const playerId of playerIds.slice(starterCount)) {
      overflow.push({ position, playerId });
    }
  }

  const flexEligible = new Set<Position>(requirements.FLEX.eligiblePositions);
  const flexSlots = Array.from({ length: requirements.FLEX.starters }, (): RosterSlot => {
    const flexIndex = overflow.findIndex((entry) => flexEligible.has(entry.position));
    const [entry] = flexIndex >= 0 ? overflow.splice(flexIndex, 1) : [];
    return { label: 'FLEX', playerId: entry?.playerId ?? null };
  });

  const benchCount = Math.max(requirements.BENCH.spots, overflow.length);
  const benchSlots = Array.from({ length: benchCount }, (_, index): RosterSlot => ({
    label: 'BN',
    playerId: overflow[index]?.playerId ?? null,
  }));
  const starters = (positions: readonly Position[]): RosterSlot[] =>
    positions.flatMap((position) => startersByPosition.get(position) ?? []);

  return [
    ...starters(['QB', 'RB', 'WR', 'TE']),
    ...flexSlots,
    ...starters(['K', 'DEF']),
    ...benchSlots,
  ];
}
