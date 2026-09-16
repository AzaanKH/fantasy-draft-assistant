import type { NFLTeam, Position } from './player';

/**
 * Raw player data from FantasyPros ECR scraping
 * This is the intermediate format before enrichment
 */
export interface ECRPlayer {
  /** Stable FantasyPros player identifier when the API supplied it. */
  readonly fantasyProsId?: string;
  /** Published FantasyPros tier when the rankings source exposes tier headers. */
  readonly fantasyProsTier?: number;
  readonly rank: number;
  readonly name: string;
  readonly position: Position;
  readonly team: NFLTeam;
  readonly byeWeek: number;
  /** Position-specific rank (e.g., WR5 = 5) */
  readonly positionalRank: number;
  /** Best rank from experts */
  readonly bestRank: number;
  /** Worst rank from experts */
  readonly worstRank: number;
  /** Average rank from experts */
  readonly avgRank: number;
}

/**
 * Contract year player data from Spotrac
 */
export interface ContractPlayer {
  readonly name: string;
  readonly position: Position;
  readonly team: NFLTeam;
  /** Year the contract expires */
  readonly contractEndYear: number;
  /** Whether this is the final year of their contract */
  readonly isContractYear: boolean;
}

/**
 * Raw scraped data before validation
 */
export interface RawECRData {
  readonly rank: string;
  readonly playerCell: string;
  readonly position: string;
  readonly best: string;
  readonly worst: string;
  readonly avg: string;
}

/**
 * Parse player name and team from combined string
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
 * Parse position string to extract position and rank
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
      byTeam.set(ranking.team, ranking.byeWeek);
    }
  }
  return byTeam;
}
