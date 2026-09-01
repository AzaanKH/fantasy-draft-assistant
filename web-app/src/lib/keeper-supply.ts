import type { Position } from '@fantasy-draft/shared';
import { getPickNumberForTeamRound } from '@/lib/mock-draft-engine';

export interface KeeperSupplyEntry {
  readonly playerId: string;
  readonly playerName: string;
  readonly position: Position;
  readonly teamIndex: number;
  readonly round: number;
  readonly isMyKeeper: boolean;
}

export interface CanonicalKeeperAssignment extends KeeperSupplyEntry {
  readonly pickNumber: number;
}

export interface CanonicalKeeperSupply {
  /** Deterministic keeper assignments ordered by snake-draft pick number. */
  readonly assignments: readonly CanonicalKeeperAssignment[];
  /** Player ids that appeared on more than one keeper entry. */
  readonly duplicatePlayerIds: readonly string[];
  /** Entries rejected because their team or round falls outside the draft. */
  readonly invalidEntries: readonly KeeperSupplyEntry[];
  /** Entries rejected because another keeper already occupies their team/round slot. */
  readonly conflictingEntries: readonly CanonicalKeeperAssignment[];
}

interface CompletedKeeperConflictPick {
  readonly playerId: string;
  readonly pickNumber: number;
}

interface KeeperSupplyConfig {
  readonly totalTeams: number;
  readonly totalRounds: number;
}

export interface KeeperSupplyCompletenessInput {
  readonly keepersEnabled: boolean | null;
  readonly season: number | undefined;
  readonly expectedSeason: number;
  readonly isConfirmed: boolean;
  readonly configuredCount: number;
  readonly expectedCount: number;
  readonly resolvedCount: number;
  readonly canonicalCount: number;
  readonly unresolvedNames: readonly string[];
  readonly duplicateNames: readonly string[];
  readonly invalidAssignments: readonly string[];
}

export function isKeeperSupplyComplete(
  input: KeeperSupplyCompletenessInput
): boolean {
  if (input.keepersEnabled === false) return true;
  return input.isConfirmed &&
    input.season === input.expectedSeason &&
    input.configuredCount === input.expectedCount &&
    input.resolvedCount === input.expectedCount &&
    input.canonicalCount === input.expectedCount &&
    input.unresolvedNames.length === 0 &&
    input.duplicateNames.length === 0 &&
    input.invalidAssignments.length === 0;
}

/**
 * A configured keeper is only a reservation until completed draft history
 * confirms it. If completed history puts another player in that slot or puts
 * the keeper in another slot, the completed pick wins for the current session.
 */
export function getEffectiveKeeperAssignments<T extends KeeperSupplyEntry>(
  keepers: readonly T[],
  completedPicks: readonly CompletedKeeperConflictPick[],
  totalTeams: number
): T[] {
  return keepers.filter((keeper) => {
    const keeperPickNumber = getPickNumberForTeamRound(
      keeper.teamIndex,
      keeper.round,
      totalTeams
    );

    return !completedPicks.some((pick) =>
      (pick.pickNumber === keeperPickNumber && pick.playerId !== keeper.playerId) ||
      (pick.playerId === keeper.playerId && pick.pickNumber !== keeperPickNumber)
    );
  });
}

function compareAssignments(
  left: CanonicalKeeperAssignment,
  right: CanonicalKeeperAssignment
): number {
  if (left.pickNumber !== right.pickNumber) {
    return left.pickNumber - right.pickNumber;
  }
  return left.playerId.localeCompare(right.playerId);
}

function compareEntries(left: KeeperSupplyEntry, right: KeeperSupplyEntry): number {
  return left.teamIndex - right.teamIndex ||
    left.round - right.round ||
    left.playerId.localeCompare(right.playerId);
}

/**
 * Validates and normalizes confirmed keeper supply into one deterministic
 * canonical sequence: every kept player occupies exactly one snake-draft slot
 * at its configured team and round-selection cost.
 */
export function canonicalizeKeeperSupply(
  keepers: readonly KeeperSupplyEntry[],
  config: KeeperSupplyConfig
): CanonicalKeeperSupply {
  const duplicatePlayerIds = new Set<string>();
  const seenPlayerIds = new Set<string>();
  const dedupedEntries: KeeperSupplyEntry[] = [];
  for (const keeper of keepers) {
    if (seenPlayerIds.has(keeper.playerId)) {
      duplicatePlayerIds.add(keeper.playerId);
      continue;
    }
    seenPlayerIds.add(keeper.playerId);
    dedupedEntries.push(keeper);
  }

  const validEntries: CanonicalKeeperAssignment[] = [];
  const invalidEntries: KeeperSupplyEntry[] = [];
  const conflictingEntries: CanonicalKeeperAssignment[] = [];
  const occupiedPickNumbers = new Set<number>();

  const candidates = dedupedEntries
    .map((keeper) => ({
      ...keeper,
      pickNumber:
        Number.isInteger(keeper.teamIndex) &&
        keeper.teamIndex >= 0 &&
        keeper.teamIndex < config.totalTeams &&
        Number.isInteger(keeper.round) &&
        keeper.round >= 1 &&
        keeper.round <= config.totalRounds
          ? getPickNumberForTeamRound(keeper.teamIndex, keeper.round, config.totalTeams)
          : null,
    }))
    .sort((left, right) => {
      if (left.pickNumber === null || right.pickNumber === null) {
        return left.pickNumber === null ? 1 : -1;
      }
      return left.pickNumber - right.pickNumber || left.playerId.localeCompare(right.playerId);
    });

  for (const candidate of candidates) {
    const { pickNumber } = candidate;
    if (pickNumber === null) {
      const { pickNumber: _pickNumber, ...keeper } = candidate;
      invalidEntries.push(keeper);
      continue;
    }
    if (occupiedPickNumbers.has(pickNumber)) {
      conflictingEntries.push({ ...candidate, pickNumber });
      continue;
    }
    occupiedPickNumbers.add(pickNumber);
    validEntries.push({ ...candidate, pickNumber });
  }

  return {
    assignments: [...validEntries].sort(compareAssignments),
    duplicatePlayerIds: [...duplicatePlayerIds].sort((left, right) => left.localeCompare(right)),
    invalidEntries: invalidEntries.sort(compareEntries),
    conflictingEntries: conflictingEntries.sort(compareAssignments),
  };
}
