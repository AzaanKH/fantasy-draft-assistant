import type { Player, Position } from '@fantasy-draft/shared/league';

export type TierPlayer = Pick<Player, 'id' | 'name' | 'position' | 'team' | 'tier' | 'ecrRank' | 'projectedPoints'>;

export interface TierGroup {
  readonly tier: number;
  /** Every player originally in the tier, drafted or not. */
  readonly total: number;
  readonly available: number;
  /** Players to show after search and the drafted filter, best ECR first. */
  readonly players: readonly TierPlayer[];
  /** The tier's undrafted players, best ECR first, whatever the search or drafted filter. */
  readonly remaining: readonly TierPlayer[];
}

export interface PositionTierGroup extends TierGroup {
  /**
   * Projected points lost crossing from the tier just above into this one, or null for the first tier or when the
   * tier above is not the group listed just before this one (a search hid it).
   */
  readonly dropBefore: number | null;
}

export interface PositionTiers {
  readonly position: Position;
  /** First tier that still has an available player. */
  readonly activeTier: number | null;
  /** Earlier tiers with no available players. */
  readonly exhaustedTiers: readonly number[];
  readonly groups: readonly PositionTierGroup[];
  /** Points lost when the active tier runs out: the drop to the next tier with players left. Null with none left. */
  readonly activeDrop: number | null;
  /** The active tier's undrafted players, whatever the search. */
  readonly activeRemaining: readonly TierPlayer[];
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
  const membersOf = (tier: number): readonly TierPlayer[] => pool.filter((player) => player.tier === tier);
  const remainingOf = (tier: number): readonly TierPlayer[] => membersOf(tier)
    .filter((player) => !draftedPlayerIds.has(player.id))
    .sort((first, second) => first.ecrRank - second.ecrRank);
  // A drafted-out tier still has a boundary: measure it on everyone who was in it.
  const dropBasis = (tier: number): readonly TierPlayer[] => {
    const remaining = remainingOf(tier);
    return remaining.length > 0 ? remaining : membersOf(tier);
  };
  const activeTier = tiers.find((tier) => remainingOf(tier).length > 0) ?? null;
  const normalizedQuery = query.trim().toLowerCase();

  const listed = tiers
    .filter((tier) => activeTier === null || showDrafted || normalizedQuery !== '' || tier >= activeTier)
    .map((tier) => {
      const members = membersOf(tier);
      const remaining = remainingOf(tier);
      return {
        tier,
        total: members.length,
        available: remaining.length,
        remaining,
        players: members
          .filter((player) => (showDrafted || !draftedPlayerIds.has(player.id)) &&
            (!normalizedQuery || `${player.name} ${player.team}`.toLowerCase().includes(normalizedQuery)))
          .sort((first, second) => first.ecrRank - second.ecrRank),
      };
    })
    .filter((group) => group.players.length > 0);
  // A break is measured against the group listed just above when every tier between them is drafted out (hidden or
  // not), so it is the live gap; a tier with players left that a search hid in between leaves no label.
  const groups = listed.map((group, index): PositionTierGroup => {
    const above = listed[index - 1]?.tier;
    const live = above !== undefined && tiers.every((tier) => tier <= above || tier >= group.tier || remainingOf(tier).length === 0);
    return { ...group, dropBefore: live ? tierDropPoints(dropBasis(above), dropBasis(group.tier)) : null };
  });
  const nextTier = activeTier === null ? undefined : tiers.find((tier) => tier > activeTier && remainingOf(tier).length > 0);

  return {
    position,
    activeTier,
    exhaustedTiers: activeTier === null ? tiers : tiers.filter((tier) => tier < activeTier),
    groups,
    activeDrop: activeTier === null || nextTier === undefined ? null : tierDropPoints(remainingOf(activeTier), remainingOf(nextTier)),
    activeRemaining: activeTier === null ? [] : remainingOf(activeTier),
  };
}

/**
 * The projected-point gap at a tier break: the weakest player above it against the strongest below it. Tiers are cut
 * at these gaps (shared tier calculation), so with nobody drafted this is the break the tiers were built from.
 */
export function tierDropPoints(upper: readonly Pick<Player, 'projectedPoints'>[], lower: readonly Pick<Player, 'projectedPoints'>[]): number | null {
  if (upper.length === 0 || lower.length === 0) return null;
  const floor = Math.min(...upper.map((player) => player.projectedPoints));
  const ceiling = Math.max(...lower.map((player) => player.projectedPoints));
  return Math.max(0, Math.round(floor - ceiling));
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
      remaining: members.filter((player) => !draftedPlayerIds.has(player.id)),
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

/**
 * The survival model's chance a player is still there at the manager's next pick; undefined when there is no estimate
 * (drafted, not modelled, or no later pick).
 */
export type SurvivalLookup = (playerId: string) => number | undefined;

/** "Likely there at your pick" means the survival model gives better than even odds. */
export const LIKELY_AVAILABLE = 0.5;

export function countLikelyAvailable(players: readonly Pick<TierPlayer, 'id'>[], survival: SurvivalLookup): number {
  return players.filter((player) => (survival(player.id) ?? 0) >= LIKELY_AVAILABLE).length;
}

/**
 * Where the "your next pick" divider sits in a list: before the first player the survival model expects to still be
 * there, or after the list when every estimated player is expected to be gone. Null when no listed player has an
 * estimate (final pick, or only drafted rows), so the divider is left out rather than guessed.
 */
export type NextPickMark = { readonly kind: 'before'; readonly playerId: string } | { readonly kind: 'after' };

export function findNextPickMark(players: readonly Pick<TierPlayer, 'id'>[], survival: SurvivalLookup): NextPickMark | null {
  let estimated = false;
  for (const player of players) {
    const probability = survival(player.id);
    if (probability === undefined) continue;
    estimated = true;
    if (probability >= LIKELY_AVAILABLE) return { kind: 'before', playerId: player.id };
  }
  return estimated ? { kind: 'after' } : null;
}

/** One position's outlook for its best remaining tier. */
export type TierStatus =
  /** Every player left in the tier is more likely gone than not by the manager's pick. */
  | { readonly kind: 'empties'; readonly tier: number }
  /** At least one player in the tier is likely still there. */
  | { readonly kind: 'lasts'; readonly tier: number; readonly likely: number }
  /** No survival estimate (final pick): just the count. */
  | { readonly kind: 'count'; readonly tier: number; readonly left: number };

export function getTierStatus(activeTier: number | null, remaining: readonly Pick<TierPlayer, 'id'>[], survival: SurvivalLookup): TierStatus | null {
  if (activeTier === null || remaining.length === 0) return null;
  if (!remaining.some((player) => survival(player.id) !== undefined)) return { kind: 'count', tier: activeTier, left: remaining.length };
  const likely = countLikelyAvailable(remaining, survival);
  return likely === 0 ? { kind: 'empties', tier: activeTier } : { kind: 'lasts', tier: activeTier, likely };
}

export function formatTierStatus(status: TierStatus, nextPickLabel: string | null): string {
  if (status.kind === 'empties') return `No Tier ${String(status.tier)} player likely at ${nextPickLabel ?? 'your pick'}`;
  if (status.kind === 'lasts') return `Tier ${String(status.tier)} should last to ${nextPickLabel ?? 'your pick'}`;
  return `${String(status.left)} left in Tier ${String(status.tier)}`;
}

export interface TierCliff {
  readonly position: Position;
  /** The tier about to run out. */
  readonly tier: number;
  readonly points: number;
  /** The steepest imminent drop at any other position, when one exists. */
  readonly othersMax: number | null;
}

/**
 * The steepest imminent drop on the board: for each position, the points lost when its best remaining tier runs out.
 * Null when no position has a positive drop ahead.
 */
export function findBiggestCliff(columns: readonly Pick<PositionTiers, 'position' | 'activeTier' | 'activeDrop'>[]): TierCliff | null {
  const drops = columns.flatMap((column) => column.activeTier !== null && column.activeDrop !== null && column.activeDrop > 0
    ? [{ position: column.position, tier: column.activeTier, points: column.activeDrop }]
    : []);
  const steepest = drops.reduce<(typeof drops)[number] | undefined>((best, drop) => (!best || drop.points > best.points ? drop : best), undefined);
  if (!steepest) return null;
  const others = drops.filter((drop) => drop !== steepest).map((drop) => drop.points);
  return { ...steepest, othersMax: others.length > 0 ? Math.max(...others) : null };
}
