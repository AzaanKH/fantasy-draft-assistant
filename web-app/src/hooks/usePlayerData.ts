/**
 * Player Data Hook
 *
 * Loads and transforms player data from multiple sources:
 * - ECR rankings from FantasyPros
 * - ADP from Sleeper
 * - Team environment data
 * - Contract year data
 *
 * Applies filtering, sorting, and drafted player exclusion.
 */

import {
  createContext,
  createElement,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  DraftReadinessSourceObservation,
  DraftReadinessWarningInput,
  FantasyProsSnapshot,
  MarketAdpFormat,
  MarketAdpSnapshot,
  Player,
  PlayerPrediction,
  Position,
  NFLTeam,
  SportsbookSnapshot,
  TeamEnvironment,
} from '@fantasy-draft/shared';
import {
  evaluateDraftReadiness,
  isNFLTeam,
  isMarketAdpSnapshot,
  isPosition,
  isPredictionSource,
  isSportsbookSnapshot,
} from '@fantasy-draft/shared';
import {
  buildRecommendationPlayerVariants,
  filterByPosition,
  filterDrafted,
  sortPlayers,
  type SleeperADPPlayer,
  type ContractPlayerData,
  type PlayerIdentityData,
} from '@/lib/calculations';
import { useDraftStore } from '@/stores/draftStore';
import { getEffectiveKeeperAssignments } from '@/lib/keeper-supply';
import { fantasyProsProvider } from '@/lib/providers/fantasypros';
import {
  createDataFreshnessItem,
  type DataFreshnessItem,
} from '@/lib/data-freshness';

/**
 * Sleeper ADP JSON file structure
 */
interface SleeperDataFile {
  fetchedAt: string;
  source: string;
  playerCount: number;
  players: SleeperADPPlayer[];
}

/**
 * Team environment JSON file structure
 */
interface TeamEnvDataFile {
  generatedAt: string;
  season: number;
  teamCount: number;
  teams: Record<NFLTeam, TeamEnvironment>;
}

/**
 * Contract data JSON file structure
 */
interface ContractDataFile {
  generatedAt?: string | null;
  scrapedAt?: string | null;
  contractYear: number;
  playerCount: number;
  players: ContractPlayerData[];
}

interface PredictionsDataFile {
  generatedAt: string | null;
  modelVersion: string;
  players: PlayerPrediction[];
}

interface PlayerIdentityFile {
  generatedAt: string;
  season: number;
  coverage: {
    fantasyProsRankingMatchRate: number;
    matchedDefenses: number;
  };
  players: PlayerIdentityData[];
}

interface RecommendationPolicyFile {
  generatedAt: string;
  modelVersion: string;
  modelPredictionsEnabled: boolean;
  contractSignalEnabled: boolean;
  pickEvOverrideEnabled: boolean;
  pickEvOverrideThreshold: number;
  fallback: 'model' | 'fantasypros-ecr-market';
  shadowLogging: {
    enabled: boolean;
    season: number;
    endpoint: string;
  };
  reason: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isContractDataFile(value: unknown): value is ContractDataFile {
  return (
    isRecord(value) &&
    (value['generatedAt'] === undefined ||
      value['generatedAt'] === null ||
      typeof value['generatedAt'] === 'string') &&
    (value['scrapedAt'] === undefined ||
      value['scrapedAt'] === null ||
      typeof value['scrapedAt'] === 'string') &&
    typeof value['contractYear'] === 'number' &&
    Number.isFinite(value['contractYear']) &&
    typeof value['playerCount'] === 'number' &&
    Number.isFinite(value['playerCount']) &&
    Array.isArray(value['players']) &&
    value['players'].every((player) =>
      isRecord(player) &&
      typeof player['name'] === 'string' &&
      isPosition(player['position']) &&
      isNFLTeam(player['team']) &&
      typeof player['contractEndYear'] === 'number' &&
      Number.isFinite(player['contractEndYear']) &&
      typeof player['isContractYear'] === 'boolean'
    )
  );
}

function isPredictionsDataFile(value: unknown): value is PredictionsDataFile {
  return (
    isRecord(value) &&
    (value['generatedAt'] === null || typeof value['generatedAt'] === 'string') &&
    typeof value['modelVersion'] === 'string' &&
    value['modelVersion'].length > 0 &&
    Array.isArray(value['players']) &&
    value['players'].every((player) =>
      isRecord(player) &&
      typeof player['name'] === 'string' &&
      isPosition(player['position']) &&
      isNFLTeam(player['team']) &&
      typeof player['projectedPoints'] === 'number' &&
      Number.isFinite(player['projectedPoints']) &&
      isPredictionSource(player['source'])
    )
  );
}

function isPlayerIdentityFile(value: unknown): value is PlayerIdentityFile {
  return (
    isRecord(value) &&
    typeof value['generatedAt'] === 'string' &&
    typeof value['season'] === 'number' &&
    Number.isFinite(value['season']) &&
    isRecord(value['coverage']) &&
    typeof value['coverage']['fantasyProsRankingMatchRate'] === 'number' &&
    Number.isFinite(value['coverage']['fantasyProsRankingMatchRate']) &&
    typeof value['coverage']['matchedDefenses'] === 'number' &&
    Number.isFinite(value['coverage']['matchedDefenses']) &&
    Array.isArray(value['players'])
  );
}

const SAFE_RECOMMENDATION_POLICY: RecommendationPolicyFile = {
  generatedAt: '1970-01-01T00:00:00.000Z',
  modelVersion: 'safe-ecr-fallback',
  modelPredictionsEnabled: false,
  contractSignalEnabled: false,
  pickEvOverrideEnabled: false,
  pickEvOverrideThreshold: 0,
  fallback: 'fantasypros-ecr-market',
  shadowLogging: {
    enabled: false,
    season: 2026,
    endpoint: '/api/shadow-recommendations',
  },
  reason: 'Recommendation policy unavailable; using the safe ECR fallback.',
};

function isRecommendationPolicyFile(value: unknown): value is RecommendationPolicyFile {
  return (
    isRecord(value) &&
    typeof value['generatedAt'] === 'string' &&
    typeof value['modelVersion'] === 'string' &&
    typeof value['modelPredictionsEnabled'] === 'boolean' &&
    typeof value['contractSignalEnabled'] === 'boolean' &&
    typeof value['pickEvOverrideEnabled'] === 'boolean' &&
    typeof value['pickEvOverrideThreshold'] === 'number' &&
    Number.isFinite(value['pickEvOverrideThreshold']) &&
    (value['fallback'] === 'model' || value['fallback'] === 'fantasypros-ecr-market') &&
    isRecord(value['shadowLogging']) &&
    typeof value['shadowLogging']['enabled'] === 'boolean' &&
    typeof value['shadowLogging']['season'] === 'number' &&
    Number.isFinite(value['shadowLogging']['season']) &&
    typeof value['shadowLogging']['endpoint'] === 'string' &&
    typeof value['reason'] === 'string'
  );
}

/**
 * Fetch FantasyPros snapshot data
 */
async function fetchFantasyProsSnapshot(): Promise<FantasyProsSnapshot> {
  return fantasyProsProvider.getSnapshot();
}

/**
 * Fetch Sleeper ADP data
 */
async function fetchSleeperData(): Promise<SleeperDataFile> {
  const response = await fetch('/data/sleeper-adp.json');
  if (!response.ok) {
    throw new Error(`Failed to load Sleeper data: ${String(response.status)}`);
  }
  return response.json() as Promise<SleeperDataFile>;
}

/**
 * Fetch team environment data
 */
async function fetchTeamEnvData(): Promise<TeamEnvDataFile> {
  const response = await fetch('/data/team-environment.json');
  if (!response.ok) {
    throw new Error(`Failed to load team environment data: ${String(response.status)}`);
  }
  return response.json() as Promise<TeamEnvDataFile>;
}

/**
 * Fetch contract year data
 */
async function fetchContractData(): Promise<ContractDataFile> {
  const response = await fetch('/data/contracts.json');
  if (!response.ok) {
    throw new Error(`Failed to load contract data: ${String(response.status)}`);
  }
  const parsed: unknown = await response.json();
  if (!isContractDataFile(parsed)) {
    throw new Error('Invalid contract data format');
  }
  return parsed;
}

async function fetchPredictionData(): Promise<PredictionsDataFile> {
  const response = await fetch('/data/predictions.json');
  if (response.status === 404) {
    return { generatedAt: null, modelVersion: 'none', players: [] };
  }
  if (!response.ok) {
    throw new Error(`Failed to load prediction data: ${String(response.status)}`);
  }
  const parsed: unknown = await response.json();
  if (!isPredictionsDataFile(parsed)) {
    throw new Error('Invalid prediction data format');
  }
  return parsed;
}

async function fetchPlayerIdentityData(): Promise<PlayerIdentityFile> {
  const response = await fetch('/data/player-identity.json');
  if (!response.ok) {
    throw new Error(`Failed to load player identity data: ${String(response.status)}`);
  }
  const parsed: unknown = await response.json();
  if (!isPlayerIdentityFile(parsed)) {
    throw new Error('Invalid player identity data format');
  }
  return parsed;
}

async function fetchRecommendationPolicy(): Promise<RecommendationPolicyFile> {
  const response = await fetch('/data/recommendation-policy.json');
  if (!response.ok) {
    throw new Error(`Failed to load recommendation policy: ${String(response.status)}`);
  }
  const parsed: unknown = await response.json();
  if (!isRecommendationPolicyFile(parsed)) {
    throw new Error('Invalid recommendation policy format');
  }
  return parsed;
}

async function fetchSportsbookSnapshot(): Promise<SportsbookSnapshot> {
  const response = await fetch('/api/draft-data/sportsbook');
  if (!response.ok) {
    throw new Error(`Failed to load sportsbook data: ${String(response.status)}`);
  }
  const parsed: unknown = await response.json();
  if (!isSportsbookSnapshot(parsed)) {
    throw new Error('Invalid sportsbook data format');
  }
  return parsed;
}

function getMarketAdpFormat(receptions: number): MarketAdpFormat {
  if (receptions >= 0.75) return 'ppr';
  if (receptions >= 0.25) return 'half-ppr';
  return 'standard';
}

async function fetchMarketAdp(
  format: MarketAdpFormat,
  teams: number,
  season: number
): Promise<MarketAdpSnapshot> {
  const params = new URLSearchParams({
    format,
    teams: String(teams),
    season: String(season),
  });
  const response = await fetch(`/api/market-adp?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Failed to load Fantasy Football Calculator ADP: ${String(response.status)}`);
  }
  const parsed: unknown = await response.json();
  if (!isMarketAdpSnapshot(parsed)) {
    throw new Error('Invalid Fantasy Football Calculator ADP format');
  }
  return parsed;
}

/**
 * Hook to load and merge all player data sources
 */
function useLivePlayerDataQuery() {
  const leagueSettings = useDraftStore((state) => state.leagueSettings);
  const totalTeams = useDraftStore((state) => state.config.totalTeams);
  const rosterRequirements = useDraftStore(
    (state) => state.config.rosterRequirements
  );
  const fantasyProsQuery = useQuery({
    queryKey: ['fantasypros-snapshot'],
    queryFn: fetchFantasyProsSnapshot,
    staleTime: Infinity, // Data doesn't change during draft
  });

  const sleeperQuery = useQuery({
    queryKey: ['sleeper-adp'],
    queryFn: fetchSleeperData,
    staleTime: Infinity,
  });

  const teamEnvQuery = useQuery({
    queryKey: ['team-environment'],
    queryFn: fetchTeamEnvData,
    staleTime: Infinity,
  });

  const contractQuery = useQuery({
    queryKey: ['contracts'],
    queryFn: fetchContractData,
    staleTime: Infinity,
  });

  const predictionQuery = useQuery({
    queryKey: ['predictions'],
    queryFn: fetchPredictionData,
    staleTime: Infinity,
  });
  const identityQuery = useQuery({
    queryKey: ['player-identity'],
    queryFn: fetchPlayerIdentityData,
    staleTime: Infinity,
  });
  const recommendationPolicyQuery = useQuery({
    queryKey: ['recommendation-policy'],
    queryFn: fetchRecommendationPolicy,
    staleTime: Infinity,
  });
  const sportsbookQuery = useQuery({
    queryKey: ['sportsbook-snapshot'],
    queryFn: fetchSportsbookSnapshot,
    staleTime: Infinity,
  });
  const marketAdpFormat = getMarketAdpFormat(
    leagueSettings.scoringRules.receiving.reception
  );
  const marketAdpSeason =
    fantasyProsQuery.data?.metadata.season ?? new Date().getFullYear();
  const marketAdpTeams = Math.max(8, Math.min(14, totalTeams));
  const marketAdpQuery = useQuery({
    queryKey: [
      'fantasy-football-calculator-adp',
      marketAdpFormat,
      marketAdpTeams,
      marketAdpSeason,
    ],
    queryFn: () => fetchMarketAdp(
      marketAdpFormat,
      marketAdpTeams,
      marketAdpSeason
    ),
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });

  const effectiveRecommendationPolicy =
    recommendationPolicyQuery.data ?? SAFE_RECOMMENDATION_POLICY;
  const currentSeason = new Date().getFullYear();
  const rankingsTimestamp = fantasyProsQuery.data?.metadata.refreshedAt;
  const identityTimestamp = identityQuery.data?.generatedAt;
  const sleeperTimestamp = sleeperQuery.data?.fetchedAt;
  const teamEnvironmentTimestamp = teamEnvQuery.data?.generatedAt;
  const readinessSources = {
    'trusted-rankings': {
      availability: fantasyProsQuery.isError
        ? 'missing'
        : fantasyProsQuery.data &&
            fantasyProsQuery.data.metadata.season === currentSeason &&
            fantasyProsQuery.data.rankings.length >= 350 &&
            ['api', 'manual-refresh'].includes(fantasyProsQuery.data.metadata.sourceType)
          ? 'available'
          : fantasyProsQuery.data
            ? 'invalid'
            : 'missing',
      timestamp: rankingsTimestamp,
      detail: fantasyProsQuery.error?.message ??
        'Expected at least 350 current-season rankings from the FantasyPros API or reviewed manual refresh.',
    },
    'canonical-player-identities': {
      availability: identityQuery.isError
        ? 'missing'
        : identityQuery.data &&
            identityQuery.data.season === currentSeason &&
            identityQuery.data.players.length >= 800 &&
            identityQuery.data.coverage.fantasyProsRankingMatchRate >= 0.98 &&
            identityQuery.data.coverage.matchedDefenses === 32
          ? 'available'
          : identityQuery.data
            ? 'invalid'
            : 'missing',
      timestamp: identityTimestamp,
      detail: identityQuery.error?.message ??
        'Expected at least 800 identities, 98% ranked-player coverage, and all 32 defenses.',
      dependencies: [
        { key: 'trusted-rankings', label: 'Trusted rankings', timestamp: rankingsTimestamp },
        { key: 'sleeper-player-directory', label: 'Sleeper player directory', timestamp: sleeperTimestamp },
      ],
    },
    'experimental-predictions': {
      availability: predictionQuery.isError
        ? 'missing'
        : predictionQuery.data && predictionQuery.data.players.length >= 800
          ? 'available'
          : predictionQuery.data
            ? 'invalid'
            : 'missing',
      timestamp: predictionQuery.data?.generatedAt,
      detail: predictionQuery.error?.message ??
        'Expected a model version and at least 800 experimental prediction rows.',
      dependencies: [
        { key: 'trusted-rankings', label: 'Trusted rankings', timestamp: rankingsTimestamp },
        { key: 'canonical-player-identities', label: 'Canonical player identities', timestamp: identityTimestamp },
        { key: 'team-environment', label: 'Team environment', timestamp: teamEnvironmentTimestamp },
      ],
    },
    'contract-context': {
      availability: contractQuery.isError
        ? 'missing'
        : contractQuery.data && contractQuery.data.players.length >= 50
          ? 'available'
          : contractQuery.data
            ? 'invalid'
            : 'missing',
      timestamp: contractQuery.data?.generatedAt ?? contractQuery.data?.scrapedAt,
      detail: contractQuery.error?.message ?? 'Expected at least 50 contract-context rows.',
    },
    'sportsbook-context': {
      availability: sportsbookQuery.isError
        ? 'missing'
        : sportsbookQuery.data && sportsbookQuery.data.metadata.season === currentSeason &&
            sportsbookQuery.data.overUnder.length > 0 &&
            sportsbookQuery.data.milestones.length > 0
          ? 'available'
          : sportsbookQuery.data
            ? 'invalid'
            : 'missing',
      timestamp: sportsbookQuery.data?.metadata.capturedAt,
      detail: sportsbookQuery.error?.message ??
        'Expected non-empty current-season sportsbook markets.',
    },
  } as const satisfies Readonly<Partial<Record<
    'trusted-rankings' |
    'canonical-player-identities' |
    'experimental-predictions' |
    'contract-context' |
    'sportsbook-context',
    DraftReadinessSourceObservation
  >>>;

  const readinessWarnings: DraftReadinessWarningInput[] = [];
  if (sleeperQuery.isError) {
    readinessWarnings.push({
      key: 'sleeper-player-directory',
      label: 'Sleeper player directory',
      sourceLabel: 'Sleeper player directory',
      message: sleeperQuery.error.message,
      correctiveAction: 'Run `pnpm refresh:sleeper`.',
    });
  }
  if (teamEnvQuery.isError) {
    readinessWarnings.push({
      key: 'team-environment',
      label: 'Team environment',
      sourceLabel: 'Derived team environment',
      message: teamEnvQuery.error.message,
      correctiveAction: 'Run `pnpm refresh:team-env`.',
    });
  }
  if (recommendationPolicyQuery.isError) {
    readinessWarnings.push({
      key: 'recommendation-policy',
      label: 'Recommendation policy',
      sourceLabel: 'ECR-anchored recommendation policy',
      message: recommendationPolicyQuery.error.message,
      correctiveAction: 'Run `pnpm model:backtest`.',
    });
  }

  const optionalReadiness = evaluateDraftReadiness({
    sources: {
      ...readinessSources,
      'primary-league-settings': { availability: 'available', timestamp: new Date().toISOString() },
      'confirmed-keeper-supply': { availability: 'available', timestamp: new Date().toISOString() },
    },
  });
  const predictionsReady = optionalReadiness.optionalSignals.find(
    (item) => item.key === 'experimental-predictions'
  )?.status === 'ready';
  const contractsReady = optionalReadiness.optionalSignals.find(
    (item) => item.key === 'contract-context'
  )?.status === 'ready';
  const sportsbookReady = optionalReadiness.optionalSignals.find(
    (item) => item.key === 'sportsbook-context'
  )?.status === 'ready';

  const dataFreshness = useMemo<readonly DataFreshnessItem[]>(() => [
    createDataFreshnessItem({
      key: 'fantasypros',
      label: 'FantasyPros rankings and projections',
      timestamp: fantasyProsQuery.data?.metadata.refreshedAt,
      maxAgeHours: 24,
      refreshCommand: 'pnpm refresh:fantasypros',
      requiredForLiveDraft: true,
    }),
    createDataFreshnessItem({
      key: 'sleeper',
      label: 'Sleeper player directory',
      timestamp: sleeperQuery.data?.fetchedAt,
      maxAgeHours: 24,
      refreshCommand: 'pnpm refresh:sleeper',
      requiredForLiveDraft: false,
    }),
    createDataFreshnessItem({
      key: 'ffc-adp',
      label: 'Fantasy Football Calculator ADP',
      timestamp: marketAdpQuery.data?.refreshedAt,
      maxAgeHours: 24,
      refreshCommand: 'Reconnect to the local sync server',
      requiredForLiveDraft: false,
    }),
    createDataFreshnessItem({
      key: 'identity',
      label: 'Player identity map',
      timestamp: identityQuery.data?.generatedAt,
      maxAgeHours: 24,
      refreshCommand: 'pnpm data:identity',
      requiredForLiveDraft: true,
    }),
    createDataFreshnessItem({
      key: 'team-environment',
      label: 'Team environment',
      timestamp: teamEnvQuery.data?.generatedAt,
      maxAgeHours: 24 * 14,
      refreshCommand: 'pnpm refresh:team-env',
      requiredForLiveDraft: false,
    }),
    createDataFreshnessItem({
      key: 'recommendation-policy',
      label: 'Recommendation policy',
      timestamp: recommendationPolicyQuery.data?.generatedAt,
      maxAgeHours: 24 * 7,
      refreshCommand: 'pnpm model:backtest',
      requiredForLiveDraft: false,
    }),
    createDataFreshnessItem({
      key: 'predictions',
      label: 'Prediction model',
      timestamp: predictionQuery.data?.generatedAt,
      maxAgeHours: 24 * 7,
      refreshCommand: 'pnpm model:dataset',
      requiredForLiveDraft: false,
    }),
    createDataFreshnessItem({
      key: 'contracts',
      label: 'Contract context',
      timestamp: contractQuery.data?.generatedAt ?? contractQuery.data?.scrapedAt,
      maxAgeHours: 24 * 7,
      refreshCommand: 'pnpm refresh:contracts',
      requiredForLiveDraft: false,
    }),
    createDataFreshnessItem({
      key: 'sportsbook',
      label: 'Sportsbook markets',
      timestamp: sportsbookQuery.data?.metadata.capturedAt,
      maxAgeHours: 48,
      refreshCommand: 'pnpm import:sportsbook',
      requiredForLiveDraft: false,
    }),
  ], [
    contractQuery.data?.generatedAt,
    contractQuery.data?.scrapedAt,
    fantasyProsQuery.data?.metadata.refreshedAt,
    identityQuery.data?.generatedAt,
    marketAdpQuery.data?.refreshedAt,
    predictionQuery.data?.generatedAt,
    recommendationPolicyQuery.data?.generatedAt,
    sleeperQuery.data?.fetchedAt,
    sportsbookQuery.data?.metadata.capturedAt,
    teamEnvQuery.data?.generatedAt,
  ]);
  const sportsbookIsFresh = sportsbookReady;
  const isLoading =
    fantasyProsQuery.isLoading ||
    sleeperQuery.isLoading ||
    teamEnvQuery.isLoading ||
    identityQuery.isLoading ||
    recommendationPolicyQuery.isLoading;

  const isError =
    fantasyProsQuery.isError ||
    identityQuery.isError;

  const error =
    fantasyProsQuery.error ?? identityQuery.error;

  // Merge all data sources into Player objects
  const playerVariants = useMemo(() => {
    if (
      !fantasyProsQuery.data ||
      !identityQuery.data
    ) {
      return {
        players: [],
        shadowPlayers: [],
        contractContext: [],
        sportsbookSnapshot: undefined,
      };
    }

    return buildRecommendationPlayerVariants({
      rankings: fantasyProsQuery.data.rankings,
      projections: fantasyProsQuery.data.projections,
      news: fantasyProsQuery.data.news,
      sleeperPlayers: sleeperQuery.data?.players ?? [],
      teamEnvironments:
        teamEnvQuery.data?.teams ?? {} as Record<NFLTeam, TeamEnvironment>,
      fantasyProsAdp: fantasyProsQuery.data.adp ?? [],
      identities: identityQuery.data.players,
      leagueContext: {
        marketAdp: marketAdpQuery.data?.players ?? [],
        scoringRules: leagueSettings.scoringRules,
        totalTeams,
        rosterRequirements,
      },
    }, {
      experimentalPredictions: predictionQuery.data?.players ?? [],
      experimentalPredictionsReady: predictionsReady,
      shadowLoggingEnabled: effectiveRecommendationPolicy.shadowLogging.enabled,
      contractContext: contractQuery.data?.players ?? [],
      contractContextReady: contractsReady,
      sportsbookSnapshot: sportsbookQuery.data,
      sportsbookContextReady: sportsbookReady,
    });
  }, [fantasyProsQuery.data, sleeperQuery.data, teamEnvQuery.data, contractQuery.data, contractsReady, predictionQuery.data, predictionsReady, identityQuery.data, effectiveRecommendationPolicy.shadowLogging.enabled, leagueSettings.scoringRules, marketAdpQuery.data?.players, rosterRequirements, sportsbookQuery.data, sportsbookReady, totalTeams]);

  return {
    players: playerVariants.players,
    shadowPlayers: playerVariants.shadowPlayers,
    sportsbookSnapshot: playerVariants.sportsbookSnapshot,
    isLoading,
    isError,
    error,
    dataInfo: {
      fantasyProsRefreshedAt: fantasyProsQuery.data?.metadata.refreshedAt,
      fantasyProsSource: fantasyProsQuery.data?.metadata.source,
      fantasyProsSourceType: fantasyProsQuery.data?.metadata.sourceType,
      sleeperFetchedAt: sleeperQuery.data?.fetchedAt,
      marketAdpRefreshedAt: marketAdpQuery.data?.refreshedAt,
      marketAdpSource: marketAdpQuery.data?.source ?? 'fantasypros-fallback',
      marketAdpFormat,
      marketAdpCount: marketAdpQuery.data?.players.length ?? 0,
      marketAdpError: marketAdpQuery.error ?? null,
      leagueSettingsFingerprint: leagueSettings.fingerprint,
      fantasyProsCount: fantasyProsQuery.data?.metadata.rankingCount ?? 0,
      sleeperCount: sleeperQuery.data?.playerCount ?? 0,
      sportsbookCapturedAt: sportsbookQuery.data?.metadata.capturedAt,
      sportsbookIsFresh,
      sportsbookOverUnderCount: sportsbookQuery.data?.metadata.overUnderCount ?? 0,
      sportsbookMilestoneCount: sportsbookQuery.data?.metadata.milestoneCount ?? 0,
      contractsError: contractQuery.error ?? null,
      sportsbookError: sportsbookQuery.error ?? null,
      predictionModelVersion: predictionQuery.data?.modelVersion,
      predictionGeneratedAt: predictionQuery.data?.generatedAt,
      shadowRecommendationAvailable:
        predictionsReady && effectiveRecommendationPolicy.shadowLogging.enabled,
      pickEvOverrideEnabled: effectiveRecommendationPolicy.pickEvOverrideEnabled,
      pickEvOverrideThreshold: effectiveRecommendationPolicy.pickEvOverrideThreshold,
      recommendationFallback: effectiveRecommendationPolicy.fallback,
      recommendationPolicyReason: effectiveRecommendationPolicy.reason,
      shadowLoggingEnabled:
        effectiveRecommendationPolicy.shadowLogging.enabled &&
        predictionsReady,
      shadowLoggingSeason: effectiveRecommendationPolicy.shadowLogging.season,
      shadowLoggingEndpoint: effectiveRecommendationPolicy.shadowLogging.endpoint,
      predictionsError: predictionQuery.error ?? null,
      dataFreshness,
      readinessSources,
      readinessWarnings,
    },
  };
}

export type PlayerDataQueryResult = ReturnType<typeof useLivePlayerDataQuery>;

const PlayerDataContext = createContext<PlayerDataQueryResult | null>(null);

export function LivePlayerDataProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const value = useLivePlayerDataQuery();
  return createElement(PlayerDataContext.Provider, { value }, children);
}

export function PlayerDataFixtureProvider({
  children,
  value,
}: {
  readonly children: ReactNode;
  readonly value: PlayerDataQueryResult;
}) {
  return createElement(PlayerDataContext.Provider, { value }, children);
}

export function usePlayerDataQuery(): PlayerDataQueryResult {
  const context = useContext(PlayerDataContext);
  if (!context) {
    throw new Error('usePlayerDataQuery must be used inside a player data provider');
  }
  return context;
}

/**
 * Hook to get filtered and sorted player data
 * Combines data loading with draft store state
 */
export function useFilteredPlayers() {
  const { players, isLoading, isError, error, dataInfo } = usePlayerDataQuery();

  const filter = useDraftStore((state) => state.filter);
  const sort = useDraftStore((state) => state.sort);
  const draftedPlayerIds = useDraftStore((state) => state.draftedPlayerIds);
  const draftHistory = useDraftStore((state) => state.draftHistory);
  const preloadedKeepers = useDraftStore((state) => state.preloadedKeepers);
  const totalTeams = useDraftStore((state) => state.config.totalTeams);
  const effectiveKeepers = useMemo(
    () => getEffectiveKeeperAssignments(preloadedKeepers, draftHistory, totalTeams),
    [draftHistory, preloadedKeepers, totalTeams]
  );
  const draftedPlayers = useMemo(
    () => [...draftHistory, ...effectiveKeepers],
    [draftHistory, effectiveKeepers]
  );

  const filteredPlayers = useMemo(() => {
    let result = players;

    // Filter by position
    result = filterByPosition(result, filter.position);

    // Filter out drafted players
    result = filterDrafted(result, draftedPlayerIds, draftedPlayers);

    // Filter by search query
    if (filter.searchQuery.trim()) {
      const query = filter.searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.team.toLowerCase().includes(query)
      );
    }

    // Sort
    result = sortPlayers(result, sort.field, sort.direction);

    return result;
  }, [players, filter, sort, draftedPlayerIds, draftedPlayers]);

  return {
    players: filteredPlayers,
    totalCount: players.length,
    filteredCount: filteredPlayers.length,
    isLoading,
    isError,
    error,
    dataInfo,
  };
}

/**
 * Hook to get position-specific statistics
 */
export function usePositionStats() {
  const { players } = usePlayerDataQuery();
  const draftedPlayerIds = useDraftStore((state) => state.draftedPlayerIds);
  const draftHistory = useDraftStore((state) => state.draftHistory);
  const preloadedKeepers = useDraftStore((state) => state.preloadedKeepers);
  const totalTeams = useDraftStore((state) => state.config.totalTeams);
  const effectiveKeepers = useMemo(
    () => getEffectiveKeeperAssignments(preloadedKeepers, draftHistory, totalTeams),
    [draftHistory, preloadedKeepers, totalTeams]
  );
  const draftedPlayers = useMemo(
    () => [...draftHistory, ...effectiveKeepers],
    [draftHistory, effectiveKeepers]
  );
  const availablePlayerIds = useMemo(
    () => new Set(
      filterDrafted(players, draftedPlayerIds, draftedPlayers)
        .map((player) => player.id)
    ),
    [draftedPlayerIds, draftedPlayers, players]
  );

  return useMemo(() => {
    const positions: Position[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
    const stats: Record<Position, { total: number; available: number }> = {
      QB: { total: 0, available: 0 },
      RB: { total: 0, available: 0 },
      WR: { total: 0, available: 0 },
      TE: { total: 0, available: 0 },
      K: { total: 0, available: 0 },
      DEF: { total: 0, available: 0 },
    };

    for (const player of players) {
      const pos = player.position;
      if (positions.includes(pos)) {
        stats[pos].total += 1;
        if (availablePlayerIds.has(player.id)) {
          stats[pos].available += 1;
        }
      }
    }

    return stats;
  }, [availablePlayerIds, players]);
}

/**
 * Hook to get a specific player by ID
 */
export function usePlayer(playerId: string): Player | undefined {
  const { players } = usePlayerDataQuery();
  return useMemo(
    () => players.find((p) => p.id === playerId),
    [players, playerId]
  );
}
