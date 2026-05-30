/**
 * Player value calculation utilities
 *
 * Merges ECR + Sleeper platform proxy + Team Environment data
 * and calculates value scores and highlight levels.
 */

import type {
  Player,
  HighlightLevel,
  FantasyProsProjection,
  FantasyProsNewsItem,
  NFLTeam,
  PlayerPrediction,
  Position,
  TeamEnvironment,
  ECRPlayer,
} from '@fantasy-draft/shared';
import { isTopOffense, isDecentOffense } from '@fantasy-draft/shared';
import { estimatePlayerPrediction } from './prediction-score';

/**
 * Sleeper search_rank platform proxy data structure
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

const TIER_THRESHOLDS: Record<Position, readonly number[]> = {
  QB: [4, 8, 12, 18],
  RB: [8, 16, 24, 36],
  WR: [8, 16, 24, 36],
  TE: [3, 6, 10, 16],
  K: [8, 16, 24],
  DEF: [8, 16, 24],
};

const SLEEPER_UNRANKED_SENTINEL = 9_999_999;

function resolveSleeperMarketRank(sleeperAdp: number | undefined, ecrRank: number): number {
  return sleeperAdp !== undefined &&
    Number.isFinite(sleeperAdp) &&
    sleeperAdp > 0 &&
    sleeperAdp < SLEEPER_UNRANKED_SENTINEL
    ? sleeperAdp
    : ecrRank;
}

/**
 * Calculate value score: ECR rank - Sleeper platform proxy
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

function createPlayerNamePositionKey(name: string, position: Position): string {
  return `${normalizePlayerName(name)}|${position}`;
}

function buildUniqueNamePositionMap<T extends { name: string; position: Position }>(
  players: readonly T[]
): Map<string, T> {
  const uniquePlayers = new Map<string, T>();
  const duplicateKeys = new Set<string>();

  for (const player of players) {
    const key = createPlayerNamePositionKey(player.name, player.position);
    if (uniquePlayers.has(key)) {
      duplicateKeys.add(key);
      uniquePlayers.delete(key);
      continue;
    }
    if (!duplicateKeys.has(key)) {
      uniquePlayers.set(key, player);
    }
  }

  return uniquePlayers;
}

function resolvePlayerMatch<T extends { name: string; position: Position; team: NFLTeam }>(
  player: { name: string; position: Position; team: NFLTeam },
  exactMap: ReadonlyMap<string, T>,
  fallbackMap: ReadonlyMap<string, T>
): T | undefined {
  const exactKey = createPlayerKey(player.name, player.team);
  const exactMatch = exactMap.get(exactKey);
  if (exactMatch) {
    return exactMatch;
  }

  const fallbackKey = createPlayerNamePositionKey(player.name, player.position);
  return fallbackMap.get(fallbackKey);
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
 * Merge ECR, Sleeper platform proxy, Team Environment, and Contract data into Player objects
 */
export function mergePlayerData(
  ecrPlayers: readonly ECRPlayer[],
  fantasyProsProjections: readonly FantasyProsProjection[],
  fantasyProsNews: readonly FantasyProsNewsItem[],
  sleeperPlayers: readonly SleeperADPPlayer[],
  teamEnvironments: Record<NFLTeam, TeamEnvironment>,
  contractPlayers: readonly ContractPlayerData[] = [],
  modelPredictions: readonly PlayerPrediction[] = []
): Player[] {
  const teamEnvironmentLookup: Partial<Record<NFLTeam, TeamEnvironment>> = teamEnvironments;

  // Build lookup maps for the Sleeper platform proxy and contracts
  const sleeperMap = new Map<string, SleeperADPPlayer>();
  for (const player of sleeperPlayers) {
    const key = createPlayerKey(player.name, player.team);
    sleeperMap.set(key, player);
  }
  const sleeperFallbackMap = buildUniqueNamePositionMap(sleeperPlayers);

  const contractMap = new Map<string, ContractPlayerData>();
  for (const player of contractPlayers) {
    const key = createPlayerKey(player.name, player.team);
    contractMap.set(key, player);
  }
  const contractFallbackMap = buildUniqueNamePositionMap(contractPlayers);

  const projectionMap = new Map<string, FantasyProsProjection>();
  for (const projection of fantasyProsProjections) {
    const key = createPlayerKey(projection.name, projection.team);
    projectionMap.set(key, projection);
  }
  const projectionFallbackMap = buildUniqueNamePositionMap(fantasyProsProjections);

  const newsMap = new Map<string, FantasyProsNewsItem>();
  for (const newsItem of fantasyProsNews) {
    const key = createPlayerKey(newsItem.name, newsItem.team);
    newsMap.set(key, newsItem);
  }
  const newsFallbackMap = buildUniqueNamePositionMap(fantasyProsNews);

  const predictionIdMap = new Map<string, PlayerPrediction>();
  const predictionMap = new Map<string, PlayerPrediction>();
  for (const prediction of modelPredictions) {
    if (prediction.playerId) {
      predictionIdMap.set(prediction.playerId, prediction);
    }
    const key = createPlayerKey(prediction.name, prediction.team);
    predictionMap.set(key, prediction);
  }
  const predictionFallbackMap = buildUniqueNamePositionMap(modelPredictions);

  const players: Player[] = [];
  const unmatchedEcr: string[] = [];

  for (const ecr of ecrPlayers) {
    const sleeper = resolvePlayerMatch(ecr, sleeperMap, sleeperFallbackMap);
    const canonicalTeam = sleeper?.team ?? ecr.team;
    const canonicalPlayer = { ...ecr, team: canonicalTeam };
    const contract = resolvePlayerMatch(canonicalPlayer, contractMap, contractFallbackMap);
    const projection = resolvePlayerMatch(canonicalPlayer, projectionMap, projectionFallbackMap);
    const newsItem = resolvePlayerMatch(canonicalPlayer, newsMap, newsFallbackMap);
    const teamEnv = teamEnvironmentLookup[canonicalTeam];

    // Sleeper uses 9,999,999 for unranked players. Preserve their Sleeper identity
    // but keep missing platform rank neutral so it cannot dominate recommendations.
    const sleeperAdp = resolveSleeperMarketRank(sleeper?.sleeperAdp, ecr.rank);

    if (!sleeper) {
      unmatchedEcr.push(ecr.name);
    }

    const valueScore = calculateValueScore(ecr.rank, sleeperAdp);
    const isContractYear = contract?.isContractYear ?? false;
    const highlightLevel = calculateHighlightLevel(valueScore, isContractYear, teamEnv);
    const offenseScore = teamEnv?.offenseScore ?? 5;
    const tier = getTier(ecr.position, ecr.positionalRank);
    const tierDropoffScore = getTierDropoffScore(ecr.position, ecr.positionalRank);
    const nextPickSurvivalProbability = getNextPickSurvivalProbability(valueScore);
    const newsStatus = newsItem?.status ?? getNewsStatus(sleeper?.status);
    const modelPrediction = sleeper
      ? predictionIdMap.get(sleeper.playerId)
      : undefined;
    const resolvedModelPrediction =
      modelPrediction ?? resolvePlayerMatch(canonicalPlayer, predictionMap, predictionFallbackMap);
    const prediction = estimatePlayerPrediction(
      {
        position: ecr.position,
        ecrRank: ecr.rank,
        positionalRank: ecr.positionalRank,
        sleeperAdp,
        offenseScore,
        valueScore,
        isContractYear,
        age: sleeper?.age,
        yearsExp: sleeper?.yearsExp,
        sleeperStatus: sleeper?.status,
        newsStatus,
        fantasyProsProjection: projection,
        modelPrediction: resolvedModelPrediction,
      }
    );

    players.push({
      id: sleeper?.playerId ?? `ecr-${String(ecr.rank)}`,
      name: ecr.name,
      position: ecr.position,
      team: canonicalTeam,
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
      projectedPoints: prediction.projectedPoints,
      customProjectedPoints: resolvedModelPrediction?.customProjectedPoints,
      valueOverReplacement: prediction.valueOverReplacement,
      tier,
      tierDropoffScore,
      nextPickSurvivalProbability,
      ceilingScore: prediction.ceilingScore,
      floorScore: prediction.floorScore,
      upsideScore: prediction.upsideScore,
      uncertaintyScore: prediction.uncertaintyScore,
      injuryRiskScore: prediction.injuryRiskScore,
      predictionSource: prediction.predictionSource,
      newsStatus,
      stackPartnerTeam: canonicalTeam,
      highlightLevel,
    });
  }

  if (unmatchedEcr.length > 0) {
    console.warn(
      `[mergePlayerData] ${String(unmatchedEcr.length)} ECR players not found in Sleeper data`
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
