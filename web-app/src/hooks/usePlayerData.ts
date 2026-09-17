import { mergeCoreSources, type CorePlayerDataSources } from '@/lib/calculations/recommendation-player-variants';
import { useDraftSyncConnectionStore } from '@/stores/draftSyncStore';
import { createDataFreshnessItem, type DataFreshnessItem } from '@/lib/data-freshness';
import { useDraftStore } from '@/stores/draftStore';
import type {
  DraftReadinessSourceObservation,
  DraftReadinessWarningInput,
  NFLTeam,
  TeamEnvironment,
} from '@fantasy-draft/shared';
import { evaluateDraftReadiness } from '@fantasy-draft/shared';
import { useQuery } from '@tanstack/react-query';
import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react';

import { SAFE_RECOMMENDATION_POLICY } from '@/lib/player-data/policy';
import {
  fetchContractData,
  fetchFantasyProsSnapshot,
  fetchMarketAdp,
  fetchPlayerIdentityData,
  fetchPredictionData,
  fetchRecommendationPolicy,
  fetchSleeperData,
  fetchSportsbookSnapshot,
  fetchTeamEnvData,
  getMarketAdpFormat,
} from '@/lib/player-data/queries';

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

  const connection = useDraftSyncConnectionStore((state) => state.connection);
  const contractQuery = useQuery({
    queryKey: ['contracts'],
    queryFn: fetchContractData,
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
  const predictionQuery = useQuery({
    queryKey: ['predictions'],
    queryFn: fetchPredictionData,
    staleTime: Infinity,
    enabled: recommendationPolicyQuery.data?.shadowLogging.enabled === true &&
      connection?.draftPosition != null &&
      fantasyProsQuery.isSuccess && identityQuery.isSuccess,
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
  const readinessSources = useMemo(() => ({
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
  >>>), [
    currentSeason,
    fantasyProsQuery.data, fantasyProsQuery.error, fantasyProsQuery.isError,
    identityQuery.data, identityQuery.error, identityQuery.isError,
    predictionQuery.data, predictionQuery.error, predictionQuery.isError,
    contractQuery.data, contractQuery.error, contractQuery.isError,
    sportsbookQuery.data, sportsbookQuery.error, sportsbookQuery.isError,
    rankingsTimestamp, identityTimestamp, sleeperTimestamp, teamEnvironmentTimestamp,
  ]);

  const readinessWarnings = useMemo(() => {
    const warnings: DraftReadinessWarningInput[] = [];
    if (sleeperQuery.isError) {
      warnings.push({
        key: 'sleeper-player-directory',
        label: 'Sleeper player directory',
        sourceLabel: 'Sleeper player directory',
        message: sleeperQuery.error.message,
        correctiveAction: 'Run `pnpm refresh:sleeper`.',
      });
    }
    if (teamEnvQuery.isError) {
      warnings.push({
        key: 'team-environment',
        label: 'Team environment',
        sourceLabel: 'Derived team environment',
        message: teamEnvQuery.error.message,
        correctiveAction: 'Run `pnpm refresh:team-env`.',
      });
    }
    if (recommendationPolicyQuery.isError) {
      warnings.push({
        key: 'recommendation-policy',
        label: 'Recommendation policy',
        sourceLabel: 'ECR-anchored recommendation policy',
        message: recommendationPolicyQuery.error.message,
        correctiveAction: 'Run `pnpm model:backtest`.',
      });
    }
    return warnings;
  }, [
    sleeperQuery.error, sleeperQuery.isError,
    teamEnvQuery.error, teamEnvQuery.isError,
    recommendationPolicyQuery.error, recommendationPolicyQuery.isError,
  ]);

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
    fantasyProsQuery.isLoading || identityQuery.isLoading;

  const isError =
    fantasyProsQuery.isError ||
    identityQuery.isError;

  const error =
    fantasyProsQuery.error ?? identityQuery.error;

  // Optional evidence must not change the core player array's identity.
  const coreSources = useMemo<CorePlayerDataSources | null>(() => {
    if (!fantasyProsQuery.data || !identityQuery.data) return null;
    return {
      rankings: fantasyProsQuery.data.rankings,
      projections: fantasyProsQuery.data.projections,
      news: fantasyProsQuery.data.news,
      sleeperPlayers: sleeperQuery.data?.players ?? [],
      teamEnvironments: teamEnvQuery.data?.teams ?? {} as Record<NFLTeam, TeamEnvironment>,
      fantasyProsAdp: fantasyProsQuery.data.adp ?? [],
      identities: identityQuery.data.players,
      leagueContext: {
        marketAdp: marketAdpQuery.data?.players ?? [],
        scoringRules: leagueSettings.scoringRules,
        totalTeams,
        rosterRequirements,
      },
    };
  }, [fantasyProsQuery.data, identityQuery.data, sleeperQuery.data, teamEnvQuery.data,
    marketAdpQuery.data?.players, leagueSettings.scoringRules, totalTeams, rosterRequirements]);
  const players = useMemo(() => coreSources ? mergeCoreSources(coreSources, []) : [], [coreSources]);
  const shadowPlayers = useMemo(() =>
    coreSources && predictionsReady && effectiveRecommendationPolicy.shadowLogging.enabled
      ? mergeCoreSources(coreSources, predictionQuery.data?.players ?? [])
      : [],
  [coreSources, predictionsReady, effectiveRecommendationPolicy.shadowLogging.enabled, predictionQuery.data?.players]);

  return {
    players,
    shadowPlayers,
    sportsbookSnapshot: sportsbookReady ? sportsbookQuery.data : undefined,
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
