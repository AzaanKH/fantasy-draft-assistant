import type {
  Player,
  SportsbookMilestoneLine,
  SportsbookSnapshot,
} from '@fantasy-draft/shared';
import {
  americanOddsToImpliedProbability,
  normalizeSportsbookPlayerName,
} from '@fantasy-draft/shared';

export const DEFAULT_MILESTONE_ROW_LIMIT = 8;

export interface MilestoneWatchlistRow {
  readonly player: Player;
  readonly line: SportsbookMilestoneLine;
  readonly probability: number;
}

/**
 * Matches every available player to the current DraftKings 1,000-yard market.
 * The result changes with both the imported market snapshot and live draft state.
 */
export function buildMilestoneWatchlist(
  players: readonly Player[],
  sportsbookSnapshot: SportsbookSnapshot,
  draftedPlayerIds: ReadonlySet<string>
): MilestoneWatchlistRow[] {
  const playerByName = new Map(
    players.map((player) => [
      normalizeSportsbookPlayerName(player.name),
      player,
    ])
  );
  const rowsByPlayerId = new Map<string, MilestoneWatchlistRow>();

  for (const line of sportsbookSnapshot.milestones) {
    if (
      line.sportsbook !== 'draftkings' ||
      line.market !== 'receivingYards' ||
      line.threshold !== 1_000
    ) {
      continue;
    }

    const player = playerByName.get(
      normalizeSportsbookPlayerName(line.playerName)
    );
    if (!player || draftedPlayerIds.has(player.id)) continue;

    const row = {
      player,
      line,
      probability: americanOddsToImpliedProbability(line.americanOdds),
    };
    const existing = rowsByPlayerId.get(player.id);
    if (!existing || row.probability > existing.probability) {
      rowsByPlayerId.set(player.id, row);
    }
  }

  return [...rowsByPlayerId.values()].sort(
    (a, b) =>
      b.probability - a.probability ||
      a.player.marketRank - b.player.marketRank ||
      a.player.ecrRank - b.player.ecrRank
  );
}

