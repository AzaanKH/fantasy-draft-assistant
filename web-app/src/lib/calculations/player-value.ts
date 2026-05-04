/**
 * Player value calculation utilities
 *
 * Merges ECR + Sleeper ADP + Team Environment data
 * and calculates value scores and highlight levels.
 */

import type {
  Player,
  HighlightLevel,
  NFLTeam,
  Position,
  TeamEnvironment,
  ECRPlayer,
} from '@fantasy-draft/shared';
import { isTopOffense, isDecentOffense } from '@fantasy-draft/shared';

/**
 * Sleeper ADP player data structure
 */
export interface SleeperADPPlayer {
  readonly playerId: string;
  readonly name: string;
  readonly position: Position;
  readonly team: NFLTeam;
  readonly sleeperAdp: number;
  readonly age: number | null;
  readonly yearsExp: number | null;
  readonly status: string;
}

/**
 * Contract year player data structure
 */
export interface ContractPlayerData {
  readonly name: string;
  readonly position: Position;
  readonly team: NFLTeam;
  readonly contractEndYear: number;
  readonly isContractYear: boolean;
}

/**
 * Calculate value score: ECR rank - Sleeper ADP
 * Positive = undervalued on Sleeper (good)
 * Negative = overvalued on Sleeper (bad)
 */
export function calculateValueScore(ecrRank: number, sleeperAdp: number): number {
  return sleeperAdp - ecrRank;
}

/**
 * Determine highlight level based on value, contract status, and offensive environment
 *
 * Rules from spec:
 * - strong-buy: Value >= +10 AND (contract year OR top-10 offense)
 * - good-value: Value >= +5 OR contract year with decent offense
 * - neutral: Default
 * - avoid: Value <= -15
 */
export function calculateHighlightLevel(
  valueScore: number,
  isContractYear: boolean,
  teamEnvironment: TeamEnvironment | undefined
): HighlightLevel {
  // Avoid: significantly overvalued
  if (valueScore <= -15) {
    return 'avoid';
  }

  const isTop = teamEnvironment ? isTopOffense(teamEnvironment) : false;
  const isDecent = teamEnvironment ? isDecentOffense(teamEnvironment) : false;

  // Strong buy: great value + (contract year OR top offense)
  if (valueScore >= 10 && (isContractYear || isTop)) {
    return 'strong-buy';
  }

  // Good value: decent value OR contract year with decent offense
  if (valueScore >= 5) {
    return 'good-value';
  }

  if (isContractYear && isDecent) {
    return 'good-value';
  }

  return 'neutral';
}

/**
 * Normalize player name for matching across data sources
 * Handles variations like "Ja'Marr Chase" vs "Ja'Marr Chase"
 */
export function normalizePlayerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[''`]/g, "'") // Normalize apostrophes
    .replace(/jr\.?$/i, '') // Remove Jr suffix
    .replace(/sr\.?$/i, '') // Remove Sr suffix
    .replace(/iii$/i, '') // Remove III suffix
    .replace(/ii$/i, '') // Remove II suffix
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

/**
 * Create a lookup key for matching players
 */
export function createPlayerKey(name: string, team: NFLTeam): string {
  return `${normalizePlayerName(name)}|${team}`;
}

/**
 * Merge ECR, Sleeper ADP, Team Environment, and Contract data into Player objects
 */
export function mergePlayerData(
  ecrPlayers: ECRPlayer[],
  sleeperPlayers: SleeperADPPlayer[],
  teamEnvironments: Record<NFLTeam, TeamEnvironment>,
  contractPlayers: ContractPlayerData[] = []
): Player[] {
  // Build lookup maps for Sleeper ADP and contracts
  const sleeperMap = new Map<string, SleeperADPPlayer>();
  for (const player of sleeperPlayers) {
    const key = createPlayerKey(player.name, player.team);
    sleeperMap.set(key, player);
  }

  const contractMap = new Map<string, ContractPlayerData>();
  for (const player of contractPlayers) {
    const key = createPlayerKey(player.name, player.team);
    contractMap.set(key, player);
  }

  const players: Player[] = [];
  const unmatchedEcr: string[] = [];

  for (const ecr of ecrPlayers) {
    const key = createPlayerKey(ecr.name, ecr.team);
    const sleeper = sleeperMap.get(key);
    const contract = contractMap.get(key);
    const teamEnv = teamEnvironments[ecr.team];

    // Use Sleeper ADP if available, otherwise estimate from ECR rank
    // Players not on Sleeper might be rookies or lesser-known players
    const sleeperAdp = sleeper?.sleeperAdp ?? ecr.rank + 50;

    if (!sleeper) {
      unmatchedEcr.push(ecr.name);
    }

    const valueScore = calculateValueScore(ecr.rank, sleeperAdp);
    const isContractYear = contract?.isContractYear ?? false;
    const highlightLevel = calculateHighlightLevel(valueScore, isContractYear, teamEnv);

    players.push({
      id: sleeper?.playerId ?? `ecr-${ecr.rank}`,
      name: ecr.name,
      position: ecr.position,
      team: ecr.team,
      byeWeek: ecr.byeWeek,
      ecrRank: ecr.rank,
      sleeperAdp,
      valueScore,
      isContractYear,
      contractEndYear: contract?.contractEndYear,
      offensiveEnvironmentScore: teamEnv?.offenseScore ?? 5,
      highlightLevel,
    });
  }

  if (unmatchedEcr.length > 0) {
    console.warn(
      `[mergePlayerData] ${unmatchedEcr.length} ECR players not found in Sleeper data`
    );
  }

  return players;
}

/**
 * Filter players by position
 */
export function filterByPosition(players: Player[], position: Position | 'ALL'): Player[] {
  if (position === 'ALL') {
    return players;
  }
  return players.filter((p) => p.position === position);
}

/**
 * Filter out drafted players
 */
export function filterDrafted(
  players: Player[],
  draftedIds: ReadonlySet<string>
): Player[] {
  return players.filter((p) => !draftedIds.has(p.id));
}

/**
 * Sort players by different criteria
 */
export type SortField = 'ecrRank' | 'sleeperAdp' | 'valueScore' | 'name';
export type SortDirection = 'asc' | 'desc';

export function sortPlayers(
  players: Player[],
  field: SortField,
  direction: SortDirection = 'asc'
): Player[] {
  const sorted = [...players].sort((a, b) => {
    let comparison = 0;

    switch (field) {
      case 'ecrRank':
        comparison = a.ecrRank - b.ecrRank;
        break;
      case 'sleeperAdp':
        comparison = a.sleeperAdp - b.sleeperAdp;
        break;
      case 'valueScore':
        comparison = b.valueScore - a.valueScore; // Higher value first by default
        break;
      case 'name':
        comparison = a.name.localeCompare(b.name);
        break;
    }

    return direction === 'asc' ? comparison : -comparison;
  });

  return sorted;
}
