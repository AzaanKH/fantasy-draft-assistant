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
  FantasyProsMarketStats,
  FantasyProsAdpPlayer,
  FantasyProsNewsItem,
  MarketAdpPlayer,
  NFLTeam,
  PlayerPrediction,
  Position,
  TeamEnvironment,
  ECRPlayer,
  SportsbookSnapshot,
  RosterRequirements,
  ScoringRules,
} from '@fantasy-draft/shared';
import {
  DEFAULT_ROSTER_REQUIREMENTS,
  DEFAULT_SCORING_RULES,
  calculateSportsbookProjectionAdjustment,
  isTopOffense,
  isDecentOffense,
} from '@fantasy-draft/shared';
import { applyDynamicValueOverReplacement, estimatePlayerPrediction } from './prediction-score';
import { applyPositionTiers } from './tiers';
import { calculateLeagueProjection } from './league-scoring';

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

export interface PlayerIdentityData {
  readonly canonicalId: string;
  readonly sleeperId?: string;
  readonly fantasyProsId?: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly position: Position;
  readonly team: NFLTeam;
}

export interface PlayerMergeLeagueContext {
  readonly marketAdp?: readonly MarketAdpPlayer[];
  readonly scoringRules?: ScoringRules;
  readonly totalTeams?: number;
  readonly rosterRequirements?: RosterRequirements;
}

const SLEEPER_PLACEHOLDER_RANK = 999;
const reportedUnmatchedEcrSignatures = new Set<string>();

function resolveSleeperMarketRank(sleeperAdp: number | undefined, ecrRank: number): number {
  return sleeperAdp !== undefined &&
    Number.isFinite(sleeperAdp) &&
    sleeperAdp > 0 &&
    sleeperAdp < SLEEPER_PLACEHOLDER_RANK
    ? sleeperAdp
    : ecrRank;
}

/**
 * Calculate value score: market cost - expert rank.
 * Positive = drafted later than expert rank (good value).
 * Negative = drafted earlier than expert rank (potential reach).
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
  modelPredictions: readonly PlayerPrediction[] = [],
  fantasyProsAdp: readonly FantasyProsAdpPlayer[] = [],
  identities: readonly PlayerIdentityData[] = [],
  sportsbookSnapshot?: SportsbookSnapshot,
  informationalRiskPredictions: readonly PlayerPrediction[] = [],
  leagueContext: PlayerMergeLeagueContext = {}
): Player[] {
  const teamEnvironmentLookup: Partial<Record<NFLTeam, TeamEnvironment>> = teamEnvironments;
  const scoringRules = leagueContext.scoringRules ?? DEFAULT_SCORING_RULES;
  const rosterRequirements =
    leagueContext.rosterRequirements ?? DEFAULT_ROSTER_REQUIREMENTS;
  const totalTeams = leagueContext.totalTeams ?? 10;

  // Build lookup maps for the Sleeper platform proxy and contracts
  const sleeperMap = new Map<string, SleeperADPPlayer>();
  for (const player of sleeperPlayers) {
    const key = createPlayerKey(player.name, player.team);
    sleeperMap.set(key, player);
  }
  const sleeperFallbackMap = buildUniqueNamePositionMap(sleeperPlayers);
  const sleeperIdMap = new Map(sleeperPlayers.map((player) => [player.playerId, player]));
  const identityByFantasyProsId = new Map(
    identities.flatMap((identity) =>
      identity.fantasyProsId ? [[identity.fantasyProsId, identity] as const] : []
    )
  );

  const adpIdMap = new Map(
    fantasyProsAdp.flatMap((player) =>
      player.fantasyProsId ? [[player.fantasyProsId, player] as const] : []
    )
  );
  const adpMap = new Map<string, FantasyProsAdpPlayer>();
  for (const player of fantasyProsAdp) adpMap.set(createPlayerKey(player.name, player.team), player);
  const adpFallbackMap = buildUniqueNamePositionMap(fantasyProsAdp);

  const marketAdpMap = new Map<string, MarketAdpPlayer>();
  for (const player of leagueContext.marketAdp ?? []) {
    if (player.team) marketAdpMap.set(createPlayerKey(player.name, player.team), player);
  }
  const marketAdpFallbackMap = buildUniqueNamePositionMap(
    leagueContext.marketAdp ?? []
  );

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

  const riskPredictionIdMap = new Map<string, PlayerPrediction>();
  const riskPredictionMap = new Map<string, PlayerPrediction>();
  for (const prediction of informationalRiskPredictions) {
    if (prediction.playerId) {
      riskPredictionIdMap.set(prediction.playerId, prediction);
    }
    const key = createPlayerKey(prediction.name, prediction.team);
    riskPredictionMap.set(key, prediction);
  }
  const riskPredictionFallbackMap = buildUniqueNamePositionMap(
    informationalRiskPredictions
  );

  const players: Player[] = [];
  const unmatchedEcrKeys: string[] = [];

  for (const ecr of ecrPlayers) {
    const identity = ecr.fantasyProsId
      ? identityByFantasyProsId.get(ecr.fantasyProsId)
      : undefined;
    const sleeper =
      (identity?.sleeperId ? sleeperIdMap.get(identity.sleeperId) : undefined) ??
      resolvePlayerMatch(ecr, sleeperMap, sleeperFallbackMap);
    const canonicalTeam = sleeper?.team ?? ecr.team;
    const canonicalPlayer = { ...ecr, team: canonicalTeam };
    const contract = resolvePlayerMatch(canonicalPlayer, contractMap, contractFallbackMap);
    const projection = resolvePlayerMatch(canonicalPlayer, projectionMap, projectionFallbackMap);
    const newsItem = resolvePlayerMatch(canonicalPlayer, newsMap, newsFallbackMap);
    const teamEnv = teamEnvironmentLookup[canonicalTeam];

    // Sleeper search rank remains a separate platform signal. Consensus ADP is
    // the primary observed-market input and falls back neutrally when missing.
    const sleeperSearchRank = resolveSleeperMarketRank(sleeper?.sleeperAdp, ecr.rank);
    const adp =
      (ecr.fantasyProsId ? adpIdMap.get(ecr.fantasyProsId) : undefined) ??
      resolvePlayerMatch(canonicalPlayer, adpMap, adpFallbackMap);
    const observedMarketAdp =
      (canonicalPlayer.team
        ? marketAdpMap.get(createPlayerKey(canonicalPlayer.name, canonicalPlayer.team))
        : undefined) ??
      marketAdpFallbackMap.get(
        createPlayerNamePositionKey(canonicalPlayer.name, canonicalPlayer.position)
      );
    const consensusAdp = observedMarketAdp?.adp ?? adp?.rank ?? sleeperSearchRank;

    if (!sleeper) {
      unmatchedEcrKeys.push(
        `${normalizePlayerName(ecr.name)}|${ecr.position}|${ecr.team}`
      );
    }

    const valueScore = calculateValueScore(ecr.rank, consensusAdp);
    const isContractYear = contract?.isContractYear ?? false;
    const highlightLevel = calculateHighlightLevel(valueScore, isContractYear, teamEnv);
    const offenseScore = teamEnv?.offenseScore ?? 5;
    const nextPickSurvivalProbability = getNextPickSurvivalProbability(valueScore);
    const newsStatus = newsItem?.status ?? getNewsStatus(sleeper?.status);
    const modelPrediction = sleeper
      ? predictionIdMap.get(sleeper.playerId)
      : undefined;
    const resolvedModelPrediction =
      modelPrediction ?? resolvePlayerMatch(canonicalPlayer, predictionMap, predictionFallbackMap);
    const informationalRiskPrediction =
      (sleeper ? riskPredictionIdMap.get(sleeper.playerId) : undefined) ??
      resolvePlayerMatch(
        canonicalPlayer,
        riskPredictionMap,
        riskPredictionFallbackMap
      );
    const leagueProjection = projection
      ? calculateLeagueProjection(projection, ecr.position, scoringRules)
      : undefined;
    const leagueProjectedPoints = leagueProjection?.projectedPoints;
    const prediction = estimatePlayerPrediction(
      {
        position: ecr.position,
        ecrRank: ecr.rank,
        positionalRank: ecr.positionalRank,
        sleeperAdp: consensusAdp,
        offenseScore,
        valueScore,
        isContractYear,
        age: sleeper?.age,
        yearsExp: sleeper?.yearsExp,
        sleeperStatus: sleeper?.status,
        newsStatus,
        fantasyProsProjection: projection,
        localLeagueProjectedPoints: leagueProjectedPoints,
        modelPrediction: resolvedModelPrediction,
        informationalRiskPrediction,
      }
    );
    const fantasyProsStats: FantasyProsMarketStats = projection
      ? {
          passingYards: projection.projectedPassingYards,
          passingTouchdowns: projection.projectedPassingTouchdowns,
          rushingYards: projection.projectedRushingYards,
          rushingTouchdowns: projection.projectedRushingTouchdowns,
          receivingYards: projection.projectedReceivingYards,
          receivingTouchdowns: projection.projectedReceivingTouchdowns,
          receptions: projection.projectedReceptions,
        }
      : {};
    const marketProjection = calculateSportsbookProjectionAdjustment({
      playerName: ecr.name,
      position: ecr.position,
      existingProjection: prediction.projectedPoints,
      fantasyProsStats,
      overUnderLines: sportsbookSnapshot?.overUnder ?? [],
      scoringRules,
    });
    const hasSportsbookAdjustment = marketProjection.markets.length > 0;

    players.push({
      id: identity?.canonicalId ?? sleeper?.playerId ?? `ecr-${String(ecr.rank)}`,
      name: ecr.name,
      position: ecr.position,
      team: canonicalTeam,
      byeWeek: ecr.byeWeek,
      ecrRank: ecr.rank,
      positionalRank: ecr.positionalRank,
      sleeperAdp: sleeperSearchRank,
      sleeperSearchRank,
      consensusAdp,
      valueScore,
      marketRank: consensusAdp,
      marketAdp: consensusAdp,
      marketAdpTrend: 0,
      isContractYear,
      contractEndYear: contract?.contractEndYear,
      offensiveEnvironmentScore: offenseScore,
      projectedPoints: marketProjection.adjustedProjection,
      ...(leagueProjection === undefined
        ? {}
        : {
            leagueScoringAdjustment:
              resolvedModelPrediction?.customScoringAdjustment ??
              leagueProjection.adjustment,
          }),
      ...(hasSportsbookAdjustment
        ? {
            preMarketProjectedPoints: prediction.projectedPoints,
            marketAdjustment: marketProjection.marketAdjustment,
            marketConfidence: marketProjection.confidence,
            sportsbookMarketCount: marketProjection.markets.length,
          }
        : {}),
      customProjectedPoints: resolvedModelPrediction?.customProjectedPoints,
      valueOverReplacement: prediction.valueOverReplacement,
      tier: 1,
      fantasyProsTier: ecr.fantasyProsTier,
      tierDropoffScore: 0,
      tierDropoffPoints: 0,
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

  if (unmatchedEcrKeys.length > 0) {
    const signature = [...unmatchedEcrKeys].sort().join('\0');
    if (!reportedUnmatchedEcrSignatures.has(signature)) {
      reportedUnmatchedEcrSignatures.add(signature);
      console.warn(
        `[mergePlayerData] ${String(unmatchedEcrKeys.length)} ECR players not found in Sleeper data`
      );
    }
  }

  return applyPositionTiers(
    applyDynamicValueOverReplacement(players, totalTeams, rosterRequirements)
  );
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
  draftedIds: ReadonlySet<string>,
  draftedPlayers: readonly {
    readonly playerName: string;
    readonly position: Position;
  }[] = []
): Player[] {
  const draftedIdentityKeys = new Set(
    draftedPlayers.map(
      (player) => `${normalizePlayerName(player.playerName)}|${player.position}`
    )
  );

  return players.filter(
    (player) =>
      !draftedIds.has(player.id) &&
      !draftedIdentityKeys.has(
        `${normalizePlayerName(player.name)}|${player.position}`
      )
  );
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
