import type { Player, Position } from '@fantasy-draft/shared';

export type TierPlayer = Pick<Player, 'id' | 'name' | 'position' | 'team' | 'tier' | 'ecrRank'>;

export interface TierGroup {
  readonly tier: number;
  /** Every player originally in the tier, drafted or not. */
  readonly total: number;
  readonly available: number;
  /** Players to show after search and the drafted filter, best ECR first. */
  readonly players: readonly TierPlayer[];
}

export interface PositionTiers {
  readonly position: Position;
  /** First tier that still has an available player. */
  readonly activeTier: number | null;
  /** Earlier tiers with no available players. */
  readonly exhaustedTiers: readonly number[];
  readonly groups: readonly TierGroup[];
}

/** A tier is nearly gone at two or fewer players and a third or less of its size. Display-only. */
export function isTierDepleted(group: Pick<TierGroup, 'available' | 'total'>): boolean {
  return group.available > 0 && group.available <= 2 && group.available / group.total <= 1 / 3;
}

/**
 * Groups one position into tiers. Counts use the full tier, so search and hiding drafted
 * players change what is listed but never the available / total denominators.
 */
export function buildPositionTiers({
  players,
  position,
  draftedPlayerIds,
  query = '',
  showDrafted = false,
}: {
  readonly players: readonly TierPlayer[];
  readonly position: Position;
  readonly draftedPlayerIds: ReadonlySet<string>;
  readonly query?: string;
  readonly showDrafted?: boolean;
}): PositionTiers {
  const pool = players.filter((player) => player.position === position && player.tier > 0);
  const tiers = [...new Set(pool.map((player) => player.tier))].sort((first, second) => first - second);
  const activeTier = tiers.find((tier) => pool.some((player) => player.tier === tier && !draftedPlayerIds.has(player.id))) ?? null;
  const normalizedQuery = query.trim().toLowerCase();

  const groups = tiers
    .filter((tier) => activeTier === null || showDrafted || normalizedQuery !== '' || tier >= activeTier)
    .map((tier) => {
      const members = pool.filter((player) => player.tier === tier);
      return {
        tier,
        total: members.length,
        available: members.filter((player) => !draftedPlayerIds.has(player.id)).length,
        players: members
          .filter((player) => (showDrafted || !draftedPlayerIds.has(player.id)) &&
            (!normalizedQuery || `${player.name} ${player.team}`.toLowerCase().includes(normalizedQuery)))
          .sort((first, second) => first.ecrRank - second.ecrRank),
      };
    })
    .filter((group) => group.players.length > 0);

  return {
    position,
    activeTier,
    exhaustedTiers: activeTier === null ? tiers : tiers.filter((tier) => tier < activeTier),
    groups,
  };
}
