export type { ECRPlayer } from './catalog/decoders.js';

/**
 * Format: "Ja'Marr Chase (CIN)"
 */
export function parsePlayerNameAndTeam(
  playerCell: string
): { name: string; team: string } | null {
  const match = playerCell.match(/^(.+?)\s*\(([A-Z]{2,3})\)$/);
  if (!match?.[1] || !match?.[2]) {
    return null;
  }
  return {
    name: match[1].trim(),
    team: match[2],
  };
}

/**
 * Format: "WR1", "RB12", "TE3"
 */
export function parsePositionString(
  positionStr: string
): { position: string; positionalRank: number } | null {
  const match = positionStr.match(/^([A-Z]+)(\d+)$/);
  if (!match?.[1] || !match?.[2]) {
    return null;
  }
  return {
    position: match[1],
    positionalRank: parseInt(match[2], 10),
  };
}

/** Read bye weeks only from a FantasyPros snapshot for the requested season. */
export function getTeamByeWeeks(snapshot: unknown, season: number): ReadonlyMap<string, number> {
  const data = snapshot as { metadata?: { season?: unknown }; rankings?: unknown } | null;
  if (data?.metadata?.season !== season || !Array.isArray(data.rankings)) {
    throw new Error(`Refresh the FantasyPros snapshot for ${String(season)} before scraping ECR.`);
  }

  const byTeam = new Map<string, number>();
  for (const ranking of data.rankings as { team?: unknown; byeWeek?: unknown }[]) {
    if (ranking && typeof ranking.team === 'string' &&
        typeof ranking.byeWeek === 'number' && Number.isInteger(ranking.byeWeek) &&
        ranking.byeWeek >= 1 && ranking.byeWeek <= 18) {
      const existingByeWeek = byTeam.get(ranking.team);
      if (existingByeWeek !== undefined && existingByeWeek !== ranking.byeWeek) {
        throw new Error(`Conflicting bye weeks for ${ranking.team}: ${String(existingByeWeek)} and ${String(ranking.byeWeek)}.`);
      }
      byTeam.set(ranking.team, ranking.byeWeek);
    }
  }
  return byTeam;
}
