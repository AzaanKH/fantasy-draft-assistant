import type { Player, Position } from '@fantasy-draft/shared/league';
import type { DraftDecisionView, PoolSort, Recommendation } from '@fantasy-draft/shared/draft';

/**
 * One row of the Assistant's player list. Every available player can be a row, not only the ones the model ranks:
 * `recommendation` is the model's analysis when it has one, and `modelRank` the player's place in the overall order
 * for the current lens (never the row's position in a filtered list).
 */
export interface PoolEntry {
  readonly playerId: string;
  readonly playerName: string;
  readonly position: Position;
  readonly team: string;
  readonly player: Player | undefined;
  readonly recommendation: Recommendation | undefined;
  readonly modelRank: number | undefined;
}

/** The overall order's length: a player outside it is "not in the model's top N". */
export function modelDepth(overall: Pick<DraftDecisionView, 'recommendations'>): number {
  return overall.recommendations.length;
}

export function toPoolEntry(
  recommendation: Recommendation,
  playerById: ReadonlyMap<string, Player>,
  rankByPlayerId: ReadonlyMap<string, number>
): PoolEntry {
  const player = playerById.get(recommendation.playerId);
  return {
    playerId: recommendation.playerId,
    playerName: recommendation.playerName,
    position: recommendation.position,
    team: player?.team ?? 'FA',
    player,
    recommendation,
    modelRank: rankByPlayerId.get(recommendation.playerId),
  };
}

/**
 * The model's analysis for every player it ranks: the overall order first, then each position's own list (K, DEF and
 * players deeper than the overall list). The first recommendation wins, so a player keeps their overall analysis.
 */
export function collectRecommendations(
  overall: Pick<DraftDecisionView, 'recommendations'>,
  byPosition: Readonly<Record<Position, Pick<DraftDecisionView, 'recommendations'>>>,
  positions: readonly Position[]
): ReadonlyMap<string, Recommendation> {
  const byId = new Map<string, Recommendation>();
  overall.recommendations.forEach((recommendation) => byId.set(recommendation.playerId, recommendation));
  positions.forEach((position) => {
    byPosition[position].recommendations.forEach((recommendation) => {
      if (!byId.has(recommendation.playerId)) byId.set(recommendation.playerId, recommendation);
    });
  });
  return byId;
}

/** Players ranked overall come first, by that rank; then players the model analysed at their position only, by its
 * score; then players with no analysis, by their catalog rank. */
function compareEntries(first: PoolEntry, second: PoolEntry): number {
  const group = (entry: PoolEntry): number => entry.modelRank !== undefined ? 0 : entry.recommendation ? 1 : 2;
  const byGroup = group(first) - group(second);
  if (byGroup !== 0) return byGroup;
  if (first.modelRank !== undefined && second.modelRank !== undefined) return first.modelRank - second.modelRank;
  if (first.recommendation && second.recommendation) {
    const byScore = second.recommendation.score - first.recommendation.score;
    if (byScore !== 0) return byScore;
  }
  const byCatalog = (first.player?.ecrRank ?? Number.POSITIVE_INFINITY) - (second.player?.ecrRank ?? Number.POSITIVE_INFINITY);
  return byCatalog !== 0 ? byCatalog : first.playerName.localeCompare(second.playerName);
}

function tierOf(entry: PoolEntry): number {
  return entry.recommendation?.diagnostics?.tier ?? entry.player?.tier ?? Number.POSITIVE_INFINITY;
}

/** "Tier first" keeps the given order inside each tier, like sortRecommendationsForPool. */
export function sortPoolEntries(entries: readonly PoolEntry[], sort: PoolSort): readonly PoolEntry[] {
  if (sort === 'recommendation') return entries;
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((first, second) => tierOf(first.entry) - tierOf(second.entry) || first.index - second.index)
    .map(({ entry }) => entry);
}

/**
 * Search over every available player, the same catalog the draft room's pool lists: a match is found whether or not
 * the model ranks it. Ordered by model rank, then position-only analysis, then players with no analysis.
 */
export function searchAvailablePlayers({
  available,
  recommendationById,
  rankByPlayerId,
  query,
  position,
}: {
  readonly available: readonly Player[];
  readonly recommendationById: ReadonlyMap<string, Recommendation>;
  readonly rankByPlayerId: ReadonlyMap<string, number>;
  /** Trimmed and lower-cased. */
  readonly query: string;
  readonly position: Position | null;
}): readonly PoolEntry[] {
  if (!query) return [];
  return available
    .filter((player) => (position === null || player.position === position) && `${player.name} ${player.team}`.toLowerCase().includes(query))
    .map((player): PoolEntry => {
      const recommendation = recommendationById.get(player.id);
      return {
        playerId: player.id,
        playerName: player.name,
        position: player.position,
        team: player.team,
        player,
        recommendation,
        modelRank: rankByPlayerId.get(player.id),
      };
    })
    .sort(compareEntries);
}
