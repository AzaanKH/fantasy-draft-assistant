import type { Player, Position, TierSource } from '@fantasy-draft/shared';
import { POSITIONS } from '@fantasy-draft/shared';

const MAX_POSITION_TIERS = 6;
const MAX_VALUE_TIERS = MAX_POSITION_TIERS - 1;
const MIN_GAP_POINTS = 2;

export interface TierAvailability {
  readonly position: Position;
  readonly tier: number;
  readonly remaining: number;
  readonly dropoffPoints: number;
  readonly dropoffScore: number;
  readonly isMeaningfulCliff: boolean;
  readonly nextTier?: number;
  readonly nextTierProjectedPoints?: number;
  readonly source?: TierSource;
}

interface TierAssignment {
  readonly tier: number;
  readonly tierDropoffPoints: number;
  readonly tierDropoffScore: number;
  readonly tierSource: TierSource;
}

function round(value: number, digits: number = 1): number {
  return Number(value.toFixed(digits));
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const right = sorted[middle] ?? 0;
  const left = sorted[Math.max(0, middle - 1)] ?? right;
  return sorted.length % 2 === 0 ? (left + right) / 2 : right;
}

function getGapThreshold(players: readonly Player[]): number {
  const gaps = players.slice(0, -1).map((player, index) =>
    Math.max(0, player.projectedPoints - (players[index + 1]?.projectedPoints ?? 0))
  );
  if (gaps.length === 0) return Number.POSITIVE_INFINITY;

  const typicalGap = median(gaps);
  const medianAbsoluteDeviation = median(
    gaps.map((gap) => Math.abs(gap - typicalGap))
  );
  const projectionRange = Math.max(
    0,
    (players[0]?.projectedPoints ?? 0) -
      (players[players.length - 1]?.projectedPoints ?? 0)
  );

  return Math.max(
    MIN_GAP_POINTS,
    (players[0]?.projectedPoints ?? 0) * 0.03,
    typicalGap * 1.75,
    typicalGap + medianAbsoluteDeviation * 2,
    projectionRange * 0.04
  );
}

function getTierSource(players: readonly Player[]): TierSource {
  const projectionCount = players.filter(
    (player) => player.predictionSource !== 'heuristic'
  ).length;
  return projectionCount >= Math.ceil(players.length / 2)
    ? 'league-projection'
    : 'ecr-fallback';
}

function buildPositionAssignments(players: readonly Player[]): ReadonlyMap<string, TierAssignment> {
  const sorted = [...players].sort(
    (a, b) => b.projectedPoints - a.projectedPoints || a.ecrRank - b.ecrRank
  );
  const positiveVorPlayers = sorted.filter((player) => player.valueOverReplacement > 0);
  const tierablePlayers = positiveVorPlayers.length >= 2 ? positiveVorPlayers : sorted;
  const threshold = getGapThreshold(tierablePlayers);
  const gaps = sorted.slice(0, -1).map((player, index) => ({
    index,
    points: Math.max(
      0,
      player.projectedPoints - (sorted[index + 1]?.projectedPoints ?? 0)
    ),
  }));
  const boundaryIndexes = new Set<number>();
  let valueTierCount = 1;

  for (let index = 0; index < tierablePlayers.length - 1; index += 1) {
    const gap = gaps[index]?.points ?? 0;
    if (
      valueTierCount < MAX_VALUE_TIERS &&
      gap > threshold
    ) {
      boundaryIndexes.add(index);
      valueTierCount += 1;
    }
  }

  if (
    tierablePlayers.length > 0 &&
    tierablePlayers.length < sorted.length &&
    valueTierCount < MAX_POSITION_TIERS
  ) {
    boundaryIndexes.add(tierablePlayers.length - 1);
  }
  const source = getTierSource(sorted);
  const assignments = new Map<string, TierAssignment>();
  let tier = 1;

  sorted.forEach((player, index) => {
    const dropoffPoints = gaps[index]?.points ?? 0;
    assignments.set(player.id, {
      tier,
      tierDropoffPoints: round(dropoffPoints),
      tierDropoffScore: Number.isFinite(threshold)
        ? round(Math.min(1, dropoffPoints / threshold), 2)
        : 0,
      tierSource: source,
    });
    if (boundaryIndexes.has(index)) tier += 1;
  });

  return assignments;
}

/**
 * Builds stable, league-adjusted tiers from within-position projection gaps.
 * FantasyPros ECR remains a tie-breaker; published FantasyPros tiers are kept
 * separately on the player for comparison.
 */
export function applyPositionTiers(players: readonly Player[]): Player[] {
  const assignments = new Map<string, TierAssignment>();
  for (const position of POSITIONS) {
    const positionAssignments = buildPositionAssignments(
      players.filter((player) => player.position === position)
    );
    for (const [playerId, assignment] of positionAssignments) {
      assignments.set(playerId, assignment);
    }
  }

  return players.map((player) => {
    const assignment = assignments.get(player.id);
    return assignment ? { ...player, ...assignment } : player;
  });
}

export function getTierKey(position: Position, tier: number): string {
  return `${position}:${String(tier)}`;
}

/** Derives live counts and the cliff to the next available tier. */
export function calculateTierAvailability(
  availablePlayers: readonly Player[]
): ReadonlyMap<string, TierAvailability> {
  const summaries = new Map<string, TierAvailability>();

  for (const position of POSITIONS) {
    const positionPlayers = availablePlayers
      .filter((player) => player.position === position)
      .sort(
        (a, b) => a.tier - b.tier ||
          b.projectedPoints - a.projectedPoints ||
          a.ecrRank - b.ecrRank
      );
    const tiers = [...new Set(positionPlayers.map((player) => player.tier))];

    tiers.forEach((tier, index) => {
      const tierPlayers = positionPlayers.filter((player) => player.tier === tier);
      const nextTier = tiers[index + 1];
      const nextPlayer = nextTier === undefined
        ? undefined
        : positionPlayers.find((player) => player.tier === nextTier);
      const bottomPlayer = [...tierPlayers].sort(
        (a, b) => a.projectedPoints - b.projectedPoints || b.ecrRank - a.ecrRank
      )[0];
      const bottomProjection = bottomPlayer?.projectedPoints ?? 0;
      const dropoffPoints = nextPlayer
        ? Math.max(0, bottomProjection - nextPlayer.projectedPoints)
        : 0;
      const meaningfulGap = Math.max(MIN_GAP_POINTS, bottomProjection * 0.03);
      const dropoffScore = nextPlayer
        ? round(Math.min(1, dropoffPoints / meaningfulGap), 2)
        : 0;
      const firstPlayer = tierPlayers[0];

      summaries.set(getTierKey(position, tier), {
        position,
        tier,
        remaining: tierPlayers.length,
        dropoffPoints: round(dropoffPoints),
        dropoffScore,
        isMeaningfulCliff:
          nextPlayer !== undefined && dropoffPoints >= meaningfulGap,
        nextTier,
        nextTierProjectedPoints: nextPlayer?.projectedPoints,
        source: firstPlayer?.tierSource,
      });
    });
  }

  return summaries;
}
