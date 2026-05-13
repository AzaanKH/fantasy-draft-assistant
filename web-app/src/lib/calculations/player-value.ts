/**
 * Player value calculation utilities
 *
 * Merges ECR + Sleeper ADP + Team Environment data
 * and calculates value scores and highlight levels.
 */

import type {
  Player,
  HighlightLevel,
  FantasyProsProjection,
  FantasyProsNewsItem,
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

const REPLACEMENT_POSITIONAL_RANKS: Record<Position, number> = {
  QB: 12,
  RB: 30,
  WR: 30,
  TE: 14,
  K: 12,
  DEF: 12,
};

const TIER_THRESHOLDS: Record<Position, readonly number[]> = {
  QB: [4, 8, 12, 18],
  RB: [8, 16, 24, 36],
  WR: [8, 16, 24, 36],
  TE: [3, 6, 10, 16],
  K: [8, 16, 24],
  DEF: [8, 16, 24],
};

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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getTier(position: Position, positionalRank: number): number {
  const thresholds = TIER_THRESHOLDS[position];
  const thresholdIndex = thresholds.findIndex((threshold) => positionalRank <= threshold);
  return thresholdIndex >= 0 ? thresholdIndex + 1 : thresholds.length + 1;
}

function getTierDropoffScore(position: Position, positionalRank: number): number {
  const thresholds = TIER_THRESHOLDS[position];
  const tier = getTier(position, positionalRank);
  const tierStart = tier === 1 ? 1 : (thresholds[tier - 2] ?? 0) + 1;
  const tierEnd = thresholds[tier - 1] ?? (thresholds[thresholds.length - 1] ?? positionalRank);
  const progress = clamp(
    (positionalRank - tierStart) / Math.max(1, tierEnd - tierStart + 1),
    0,
    1
  );
  const dropoff = clamp(1 - progress, 0, 1);
  return Number(dropoff.toFixed(2));
}

function getProjectedPoints(ecrRank: number, sleeperAdp: number, offenseScore: number): number {
  const rankScore = Math.max(0, 300 - ecrRank);
  const marketScore = Math.max(0, 300 - sleeperAdp);
  return Number((rankScore * 0.45 + marketScore * 0.35 + offenseScore * 8).toFixed(1));
}

function getValueOverReplacement(position: Position, positionalRank: number): number {
  const replacementRank = REPLACEMENT_POSITIONAL_RANKS[position];
  return Math.max(0, replacementRank - positionalRank);
}

function getNextPickSurvivalProbability(valueScore: number): number {
  return Number(clamp(0.5 + valueScore / 50, 0.05, 0.95).toFixed(2));
}

function getNewsStatus(status: string | undefined): Player['newsStatus'] {
  const normalized = status?.toLowerCase() ?? 'unknown';
  if (normalized.includes('question')) return 'questionable';
  if (normalized.includes('inactive')) return 'out';
  if (normalized.includes('out') || normalized.includes('injured reserve')) return 'out';
  if (normalized.includes('limited')) return 'limited';
  if (/\bactive\b/.test(normalized)) return 'healthy';
  return 'unknown';
}

/**
 * Merge ECR, Sleeper ADP, Team Environment, and Contract data into Player objects
 */
export function mergePlayerData(
  ecrPlayers: readonly ECRPlayer[],
  fantasyProsProjections: readonly FantasyProsProjection[],
  fantasyProsNews: readonly FantasyProsNewsItem[],
  sleeperPlayers: readonly SleeperADPPlayer[],
  teamEnvironments: Record<NFLTeam, TeamEnvironment>,
  contractPlayers: readonly ContractPlayerData[] = []
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

  const projectionMap = new Map<string, FantasyProsProjection>();
  for (const projection of fantasyProsProjections) {
    const key = createPlayerKey(projection.name, projection.team);
    projectionMap.set(key, projection);
  }

  const newsMap = new Map<string, FantasyProsNewsItem>();
  for (const newsItem of fantasyProsNews) {
    const key = createPlayerKey(newsItem.name, newsItem.team);
    newsMap.set(key, newsItem);
  }

  const players: Player[] = [];
  const unmatchedEcr: string[] = [];

  for (const ecr of ecrPlayers) {
    const key = createPlayerKey(ecr.name, ecr.team);
    const sleeper = sleeperMap.get(key);
    const contract = contractMap.get(key);
    const teamEnv = teamEnvironments[ecr.team];
    const projection = projectionMap.get(key);
    const newsItem = newsMap.get(key);

    // Use Sleeper ADP if available, otherwise estimate from ECR rank
    // Players not on Sleeper might be rookies or lesser-known players
    const sleeperAdp = sleeper?.sleeperAdp ?? ecr.rank + 50;

    if (!sleeper) {
      unmatchedEcr.push(ecr.name);
    }

    const valueScore = calculateValueScore(ecr.rank, sleeperAdp);
    const isContractYear = contract?.isContractYear ?? false;
    const highlightLevel = calculateHighlightLevel(valueScore, isContractYear, teamEnv);
    const offenseScore = teamEnv?.offenseScore ?? 5;
    const projectedPoints = projection?.projectedPoints
      ?? getProjectedPoints(ecr.rank, sleeperAdp, offenseScore);
    const valueOverReplacement = getValueOverReplacement(ecr.position, ecr.positionalRank);
    const tier = getTier(ecr.position, ecr.positionalRank);
    const tierDropoffScore = getTierDropoffScore(ecr.position, ecr.positionalRank);
    const nextPickSurvivalProbability = getNextPickSurvivalProbability(valueScore);
    const upsideScore = Number(
      clamp(
        5 + valueScore / 6 + offenseScore / 2 + (isContractYear ? 0.75 : 0),
        1,
        10
      ).toFixed(1)
    );
    const floorScore = Number(
      clamp(
        4 + valueOverReplacement / 5 + offenseScore / 2 - Math.max(0, -valueScore) / 10,
        1,
        10
      ).toFixed(1)
    );
    const ceilingScore = Number(clamp((upsideScore + offenseScore) / 2, 1, 10).toFixed(1));
    const injuryRiskScore = Number(
      clamp(
        newsItem?.status === 'healthy'
          ? 2
          : sleeper?.status === 'Active'
            ? 2
            : newsItem?.status === 'limited'
              ? 5
              : sleeper?.status || newsItem
                ? 6
                : 4,
        1,
        10
      ).toFixed(1)
    );

    players.push({
      id: sleeper?.playerId ?? `ecr-${ecr.rank}`,
      name: ecr.name,
      position: ecr.position,
      team: ecr.team,
      byeWeek: ecr.byeWeek,
      ecrRank: ecr.rank,
      sleeperAdp,
      valueScore,
      marketRank: sleeperAdp,
      marketAdp: sleeperAdp,
      marketAdpTrend: 0,
      isContractYear,
      contractEndYear: contract?.contractEndYear,
      offensiveEnvironmentScore: offenseScore,
      projectedPoints,
      valueOverReplacement,
      tier,
      tierDropoffScore,
      nextPickSurvivalProbability,
      ceilingScore,
      floorScore,
      upsideScore,
      injuryRiskScore,
      newsStatus: newsItem?.status ?? getNewsStatus(sleeper?.status),
      stackPartnerTeam: ecr.team,
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
export type SortField =
  | 'ecrRank'
  | 'sleeperAdp'
  | 'valueScore'
  | 'projectedPoints'
  | 'valueOverReplacement'
  | 'upsideScore'
  | 'name';
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
      case 'projectedPoints':
        comparison = b.projectedPoints - a.projectedPoints;
        break;
      case 'valueOverReplacement':
        comparison = b.valueOverReplacement - a.valueOverReplacement;
        break;
      case 'upsideScore':
        comparison = b.upsideScore - a.upsideScore;
        break;
      case 'name':
        comparison = a.name.localeCompare(b.name);
        break;
    }

    return direction === 'asc' ? comparison : -comparison;
  });

  return sorted;
}
