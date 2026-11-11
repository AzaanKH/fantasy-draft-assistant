import type { Player, Position } from '@fantasy-draft/shared/league';

export type TierPlayer = Pick<Player, 'id' | 'name' | 'position' | 'team' | 'tier' | 'ecrRank'>;

export interface TierGroup {
  readonly tier: number;
  /** Every player originally in the tier, drafted or not. */
  readonly total: number;
  readonly available: number;
  /** Players to show after search and the drafted filter, best ECR first. */
  readonly players: readonly TierPlayer[];
}

interface PositionTiers {
  readonly position: Position;
  /** First tier that still has an available player. */
  readonly activeTier: number | null;
  /** Earlier tiers with no available players. */
  readonly exhaustedTiers: readonly number[];
  readonly groups: readonly TierGroup[];
}

const DISPLAY_ONLY_DEPLETED_TIER = {
  maxAvailable: 2,
  maxAvailableShare: 1 / 3,
} as const;

export function isTierDepleted(group: Pick<TierGroup, 'available' | 'total'>): boolean {
  return group.available > 0 &&
    group.available <= DISPLAY_ONLY_DEPLETED_TIER.maxAvailable &&
    group.available / group.total <= DISPLAY_ONLY_DEPLETED_TIER.maxAvailableShare;
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

export interface OverallBand extends TierGroup {
  /** "#1–10" style label from the band's first and last expert ranks. */
  readonly label: string;
}

/**
 * Overall cheat-sheet column. Overall rankings have no tiers, so players are banded into
 * draft-round-sized groups of the expert order (band size = league teams). Like position
 * tiers, counts use the whole band and earlier fully drafted bands are skipped.
 */
export function buildOverallBands({
  players,
  draftedPlayerIds,
  bandSize,
  query = '',
  showDrafted = false,
}: {
  readonly players: readonly TierPlayer[];
  readonly draftedPlayerIds: ReadonlySet<string>;
  readonly bandSize: number;
  readonly query?: string;
  readonly showDrafted?: boolean;
}): { readonly activeTier: number | null; readonly exhaustedTiers: readonly number[]; readonly groups: readonly OverallBand[] } {
  const size = Math.max(1, Math.floor(bandSize));
  const ranked = players
    .filter((player) => player.ecrRank > 0)
    .slice()
    .sort((first, second) => first.ecrRank - second.ecrRank || first.name.localeCompare(second.name));
  const normalizedQuery = query.trim().toLowerCase();
  const bands = Array.from({ length: Math.ceil(ranked.length / size) }, (_, index) => {
    const members = ranked.slice(index * size, (index + 1) * size);
    const first = members[0];
    const last = members.at(-1);
    return {
      tier: index + 1,
      label: first && last ? `#${String(first.ecrRank)}–${String(last.ecrRank)}` : '',
      total: members.length,
      available: members.filter((player) => !draftedPlayerIds.has(player.id)).length,
      members,
    };
  });
  const activeTier = bands.find((band) => band.available > 0)?.tier ?? null;
  const groups = bands
    .filter((band) => activeTier === null || showDrafted || normalizedQuery !== '' || band.tier >= activeTier)
    .map(({ members, ...band }) => ({
      ...band,
      players: members.filter((player) => (showDrafted || !draftedPlayerIds.has(player.id)) &&
        (!normalizedQuery || `${player.name} ${player.team}`.toLowerCase().includes(normalizedQuery))),
    }))
    .filter((band) => band.players.length > 0);
  return {
    activeTier,
    exhaustedTiers: bands.filter((band) => activeTier === null || band.tier < activeTier).map((band) => band.tier),
    groups,
  };
}

/** Available players per position tier, keyed by `tierKey`. Players without a tier are skipped. */
export function countAvailableByTier(available: readonly Pick<Player, 'position' | 'tier'>[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const player of available) {
    if (player.tier <= 0) continue;
    const key = tierKey(player.position, player.tier);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function tierKey(position: Position, tier: number): string {
  return `${position}-${String(tier)}`;
}

/** Tiers this close to empty are called out wherever the scarcity shows (pool rows, tier headers). */
export const SCARCE_TIER_REMAINING = 2;

/** "2 left in RB T2". Counts include the player itself. */
export function formatTierScarcity(position: Position, tier: number, remaining: number): string {
  return `${String(remaining)} left in ${position} T${String(tier)}`;
}
