import type { NFLTeam, Position } from './player';

/**
 * Raw player data from FantasyPros ECR scraping
 * This is the intermediate format before enrichment
 */
export interface ECRPlayer {
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

/**
 * NFL team bye weeks for 2025 season
 * This will need to be updated each year
 */
export const BYE_WEEKS_2025: Record<NFLTeam, number> = {
  ARI: 11,
  ATL: 12,
  BAL: 14,
  BUF: 12,
  CAR: 11,
  CHI: 7,
  CIN: 12,
  CLE: 9,
  DAL: 7,
  DEN: 14,
  DET: 5,
  GB: 10,
  HOU: 14,
  IND: 14,
  JAX: 12,
  KC: 6,
  LAC: 5,
  LAR: 6,
  LV: 10,
  MIA: 6,
  MIN: 6,
  NE: 14,
  NO: 12,
  NYG: 11,
  NYJ: 12,
  PHI: 5,
  PIT: 9,
  SEA: 10,
  SF: 9,
  TB: 11,
  TEN: 5,
  WAS: 14,
} as const;
