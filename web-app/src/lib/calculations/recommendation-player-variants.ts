import type {
  ECRPlayer,
  FantasyProsAdpPlayer,
  FantasyProsNewsItem,
  FantasyProsProjection,
  NFLTeam,
  Player,
  PlayerPrediction,
  SportsbookSnapshot,
  TeamEnvironment,
} from '@fantasy-draft/shared';
import {
  mergePlayerData,
  type ContractPlayerData,
  type PlayerIdentityData,
  type PlayerMergeLeagueContext,
  type SleeperADPPlayer,
} from './player-value';

export interface CorePlayerDataSources {
  readonly rankings: readonly ECRPlayer[];
  readonly projections: readonly FantasyProsProjection[];
  readonly news: readonly FantasyProsNewsItem[];
  readonly sleeperPlayers: readonly SleeperADPPlayer[];
  readonly teamEnvironments: Readonly<Record<NFLTeam, TeamEnvironment>>;
  readonly fantasyProsAdp: readonly FantasyProsAdpPlayer[];
  readonly identities: readonly PlayerIdentityData[];
  readonly leagueContext: PlayerMergeLeagueContext;
}

export interface OptionalPlayerSignals {
  readonly experimentalPredictions: readonly PlayerPrediction[];
  readonly experimentalPredictionsReady: boolean;
  readonly shadowLoggingEnabled: boolean;
  readonly contractContext: readonly ContractPlayerData[];
  readonly contractContextReady: boolean;
  readonly sportsbookSnapshot?: SportsbookSnapshot;
  readonly sportsbookContextReady: boolean;
}

export interface RecommendationPlayerVariants {
  /** The only player records allowed to feed live Best Pick and Best Player. */
  readonly players: Player[];
  /** Experimental records used only to produce Shadow Recommendations. */
  readonly shadowPlayers: Player[];
  /** Fresh optional context exposed for read-only product evidence. */
  readonly contractContext: readonly ContractPlayerData[];
  /** Fresh optional context exposed for read-only product evidence. */
  readonly sportsbookSnapshot?: SportsbookSnapshot;
}

function mergeCoreSources(
  sources: CorePlayerDataSources,
  modelPredictions: readonly PlayerPrediction[]
): Player[] {
  return mergePlayerData(
    sources.rankings,
    sources.projections,
    sources.news,
    sources.sleeperPlayers,
    sources.teamEnvironments as Record<NFLTeam, TeamEnvironment>,
    [],
    modelPredictions,
    sources.fantasyProsAdp,
    sources.identities,
    undefined,
    [],
    sources.leagueContext
  );
}

/**
 * Builds the product-boundary views for recommendation data.
 *
 * Core recommendations never receive predictions, contract context, or
 * sportsbook context. A ready prediction artifact may build a separate shadow
 * view, while the other optional inputs remain read-only evidence.
 */
export function buildRecommendationPlayerVariants(
  sources: CorePlayerDataSources,
  optionalSignals: OptionalPlayerSignals
): RecommendationPlayerVariants {
  const players = mergeCoreSources(sources, []);
  const shadowPlayers = optionalSignals.experimentalPredictionsReady &&
    optionalSignals.shadowLoggingEnabled
    ? mergeCoreSources(sources, optionalSignals.experimentalPredictions)
    : [];

  return {
    players,
    shadowPlayers,
    contractContext: optionalSignals.contractContextReady
      ? optionalSignals.contractContext
      : [],
    sportsbookSnapshot: optionalSignals.sportsbookContextReady
      ? optionalSignals.sportsbookSnapshot
      : undefined,
  };
}
