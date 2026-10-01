import { POSITIONS, type Player, type Position, type PositionNeed } from '@fantasy-draft/shared';
import { calculateTierAvailability, getTierKey } from '@/lib/calculations/tiers';

export interface PositionalDepth {
  readonly position: Position;
  tier1: number;
  tier2: number;
  tier3: number;
  other: number;
  total: number;
}

export function getPositionalDepth(players: readonly Pick<Player, 'id' | 'position' | 'tier'>[], draftedIds: ReadonlySet<string>): PositionalDepth[] {
  const availablePlayers = getAvailableDepthPlayers(players, draftedIds);
  return POSITIONS.map((position) => {
    const row: PositionalDepth = { position, tier1: 0, tier2: 0, tier3: 0, other: 0, total: 0 };
    for (const player of availablePlayers) {
      if (player.position !== position) continue;
      row.total += 1;
      if (player.tier === 1) row.tier1 += 1;
      else if (player.tier === 2) row.tier2 += 1;
      else if (player.tier === 3) row.tier3 += 1;
      else row.other += 1;
    }
    return row;
  });
}

export type DepthTier = number | 'unranked';
export type DepthFilter = DepthTier | 'all';

export function depthTier(tier: number): DepthTier {
  return Number.isInteger(tier) && tier > 0 ? tier : 'unranked';
}

/** Counts and drilldowns share exactly the same deduplicated, available pool. */
export function getAvailableDepthPlayers<T extends Pick<Player, 'id'>>(
  players: readonly T[],
  excludedIds: ReadonlySet<string>
): T[] {
  const seen = new Set<string>();
  return players.filter((player) => {
    if (excludedIds.has(player.id) || seen.has(player.id)) return false;
    seen.add(player.id);
    return true;
  });
}

export function getDepthTiers(players: readonly Pick<Player, 'tier'>[], showAll: boolean): DepthTier[] {
  if (!showAll) return [1, 2, 3];
  const tiers = new Set(players.map((player) => depthTier(player.tier)));
  const ranked = [...tiers].filter((tier): tier is number => typeof tier === 'number');
  const result: DepthTier[] = [...new Set([1, 2, 3, ...ranked])].sort((a, b) => a - b);
  if (tiers.has('unranked')) result.push('unranked');
  return result;
}

export function getDepthPlayers(
  players: readonly Player[], position: Position, filter: DepthFilter
): Player[] {
  return players.filter((player) => player.position === position &&
    (filter === 'all' || depthTier(player.tier) === filter))
    .sort((a, b) => a.ecrRank - b.ecrRank || b.projectedPoints - a.projectedPoints || a.id.localeCompare(b.id));
}

export function getDepthRosterOpenings(needs: readonly PositionNeed[]): {
  fixed: ReadonlyMap<Position, number>;
  flex: number;
} {
  const flexNeed = needs.find((need) => need.isFlexEligible);
  return {
    fixed: new Map(needs.map((need) => [need.position, Math.max(0, need.startersNeeded - need.startersFilled)])),
    flex: flexNeed ? Math.max(0, flexNeed.flexSlotsNeeded - flexNeed.flexSlotsFilled) : 0,
  };
}

/** The same tier boundary used by the decision policy, with missing estimates withheld. */
export function getDepthTierDrop(players: readonly Player[], position: Position, tier: DepthFilter): {
  points: number;
  nextTier: number;
} | null {
  if (typeof tier !== 'number') return null;
  const positionPlayers = players.filter((player) => player.position === position && depthTier(player.tier) !== 'unranked');
  const nextTier = positionPlayers.reduce((next, player) => player.tier > tier ? Math.min(next, player.tier) : next, Infinity);
  const current = positionPlayers.filter((player) => player.tier === tier);
  const next = positionPlayers.filter((player) => player.tier === nextTier);
  if (!current.length || !next.length || [...current, ...next].some((player) =>
    !Number.isFinite(player.projectedPoints) || player.predictionSource === 'heuristic'
  )) return null;
  const summary = calculateTierAvailability([...current, ...next]).get(getTierKey(position, tier));
  return summary ? { points: summary.dropoffPoints, nextTier } : null;
}
