import {
  formatDraftReadinessAge,
  type DraftReadinessReport,
  type Player,
  type Position,
  type Recommendation,
} from '@fantasy-draft/shared';

export type PositionFilter = Position | 'ALL' | 'FLEX';

const FLEX_POSITIONS: readonly Position[] = ['RB', 'WR', 'TE'];

export interface PlayerPoolRow {
  readonly player: Player;
  /** Present only for players on the current recommendation list. */
  readonly recommendation: Recommendation | undefined;
}

function matchesFilters(player: Player, positionFilter: PositionFilter, searchQuery: string): boolean {
  if (positionFilter === 'FLEX' && !FLEX_POSITIONS.includes(player.position)) return false;
  if (positionFilter !== 'ALL' && positionFilter !== 'FLEX' && player.position !== positionFilter) return false;
  if (!searchQuery) return true;
  return player.name.toLowerCase().includes(searchQuery) || player.team.toLowerCase().includes(searchQuery);
}

/**
 * Every undrafted player that matches the filters. The recommendation list is capped and
 * empty while advice is blocked, so it only orders the players it contains and supplies
 * their metrics; the rest follow by expert rank and stay searchable.
 */
export function getPlayerPoolRows(
  undraftedPlayers: readonly Player[],
  recommendations: readonly Recommendation[],
  positionFilter: PositionFilter,
  searchQuery: string
): PlayerPoolRow[] {
  const recommendationById = new Map(recommendations.map((recommendation) => [recommendation.playerId, recommendation]));
  const recommendationOrder = new Map(recommendations.map((recommendation, index) => [recommendation.playerId, index]));
  return undraftedPlayers
    .filter((player) => matchesFilters(player, positionFilter, searchQuery))
    .sort((a, b) =>
      (recommendationOrder.get(a.id) ?? Number.POSITIVE_INFINITY) - (recommendationOrder.get(b.id) ?? Number.POSITIVE_INFINITY) ||
      a.ecrRank - b.ecrRank ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id)
    )
    .map((player) => ({ player, recommendation: recommendationById.get(player.id) }));
}

/** Why advice is paused, and how old the rankings being browsed are. */
export function describePausedAdvice(
  readiness: DraftReadinessReport | null,
  blockedByProviderIdentity: boolean
): string {
  if (blockedByProviderIdentity) return 'Recommendations are paused until provider picks are matched. Browse by expert rank meanwhile.';
  const rankings = readiness?.coreDraftData.find((item) => item.key === 'trusted-rankings');
  if (rankings?.problem !== 'stale' || !rankings.timestamp) return 'Recommendations are paused until setup is finished. Browse by expert rank meanwhile.';
  const date = new Date(rankings.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `Recommendations are paused because rankings are out of date. Browsing rankings from ${date} (${formatDraftReadinessAge(rankings.ageHours)}) by expert rank.`;
}
