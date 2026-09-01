import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROSTER_REQUIREMENTS,
  DEFAULT_SCORING_RULES,
  evaluateDraftReadiness,
  type DraftReadinessSourceObservation,
  type ECRPlayer,
  type FantasyProsProjection,
  type NFLTeam,
  type PlayerPrediction,
  type SportsbookSnapshot,
  type TeamEnvironment,
} from '@fantasy-draft/shared';
import { getRecommendations } from './recommendations';
import {
  buildRecommendationPlayerVariants,
  type OptionalPlayerSignals,
} from './recommendation-player-variants';
import type {
  ContractPlayerData,
  PlayerIdentityData,
  SleeperADPPlayer,
} from './player-value';

const NOW = Date.parse('2026-08-24T18:00:00.000Z');
const FRESH = '2026-08-24T17:00:00.000Z';
const STALE = '2026-08-01T17:00:00.000Z';

const rankings: readonly ECRPlayer[] = [
  {
    fantasyProsId: 'fp-1',
    rank: 1,
    name: 'ECR Anchor',
    position: 'WR',
    team: 'DET',
    byeWeek: 8,
    positionalRank: 1,
    bestRank: 1,
    worstRank: 2,
    avgRank: 1.2,
  },
  {
    fantasyProsId: 'fp-2',
    rank: 2,
    name: 'Experimental Favorite',
    position: 'WR',
    team: 'SEA',
    byeWeek: 8,
    positionalRank: 2,
    bestRank: 2,
    worstRank: 4,
    avgRank: 2.5,
  },
];

const projections: readonly FantasyProsProjection[] = [
  {
    fantasyProsId: 'fp-1',
    name: 'ECR Anchor',
    position: 'WR',
    team: 'DET',
    projectedPoints: 280,
    baseProjectedPoints: 280,
  },
  {
    fantasyProsId: 'fp-2',
    name: 'Experimental Favorite',
    position: 'WR',
    team: 'SEA',
    projectedPoints: 230,
    baseProjectedPoints: 230,
  },
];

const sleeperPlayers: readonly SleeperADPPlayer[] = [
  {
    playerId: 'player-1',
    name: 'ECR Anchor',
    position: 'WR',
    team: 'DET',
    sleeperAdp: 1,
    age: 26,
    yearsExp: 4,
    status: 'Active',
  },
  {
    playerId: 'player-2',
    name: 'Experimental Favorite',
    position: 'WR',
    team: 'SEA',
    sleeperAdp: 2,
    age: 24,
    yearsExp: 2,
    status: 'Active',
  },
];

const identities: readonly PlayerIdentityData[] = [
  {
    canonicalId: 'player-1',
    sleeperId: 'player-1',
    fantasyProsId: 'fp-1',
    name: 'ECR Anchor',
    aliases: [],
    position: 'WR',
    team: 'DET',
  },
  {
    canonicalId: 'player-2',
    sleeperId: 'player-2',
    fantasyProsId: 'fp-2',
    name: 'Experimental Favorite',
    aliases: [],
    position: 'WR',
    team: 'SEA',
  },
];

const teamEnvironments = {
  DET: {
    team: 'DET',
    name: 'Detroit Lions',
    offenseScore: 7,
    passVolume: 'high',
    rushVolume: 'medium',
    pointsRank: 5,
    passAttemptsRank: 8,
    rushAttemptsRank: 16,
    coachingStability: true,
  },
  SEA: {
    team: 'SEA',
    name: 'Seattle Seahawks',
    offenseScore: 5,
    passVolume: 'medium',
    rushVolume: 'medium',
    pointsRank: 16,
    passAttemptsRank: 16,
    rushAttemptsRank: 16,
    coachingStability: true,
  },
} as unknown as Readonly<Record<NFLTeam, TeamEnvironment>>;

const experimentalPredictions: readonly PlayerPrediction[] = [
  {
    playerId: 'player-1',
    name: 'ECR Anchor',
    position: 'WR',
    team: 'DET',
    projectedPoints: 180,
    valueOverReplacement: 2,
    source: 'model',
  },
  {
    playerId: 'player-2',
    name: 'Experimental Favorite',
    position: 'WR',
    team: 'SEA',
    projectedPoints: 400,
    valueOverReplacement: 120,
    source: 'model',
  },
];

const contractContext: readonly ContractPlayerData[] = [{
  name: 'Experimental Favorite',
  position: 'WR',
  team: 'SEA',
  contractEndYear: 2026,
  isContractYear: true,
}];

const sportsbookSnapshot: SportsbookSnapshot = {
  metadata: {
    season: 2026,
    capturedAt: FRESH,
    importedAt: FRESH,
    sourceDirectory: 'test-lines',
    overUnderCount: 1,
    milestoneCount: 1,
  },
  overUnder: [{
    sportsbook: 'draftkings',
    playerName: 'Experimental Favorite',
    market: 'receivingYards',
    line: 1800,
    overOdds: -110,
    underOdds: -110,
    sourceFile: 'test.pdf',
  }],
  milestones: [{
    sportsbook: 'draftkings',
    playerName: 'Experimental Favorite',
    market: 'receivingYards',
    threshold: 1500,
    americanOdds: 120,
    sourceFile: 'test.pdf',
  }],
  warnings: [],
};

const sources = {
  rankings,
  projections,
  news: [],
  sleeperPlayers,
  teamEnvironments,
  fantasyProsAdp: [],
  identities,
  leagueContext: {
    scoringRules: DEFAULT_SCORING_RULES,
    rosterRequirements: DEFAULT_ROSTER_REQUIREMENTS,
    totalTeams: 10,
  },
};

type Scenario = 'ready' | 'absent' | 'stale' | 'failing';

function observation(scenario: Scenario): DraftReadinessSourceObservation {
  if (scenario === 'ready') return { availability: 'available', timestamp: FRESH };
  if (scenario === 'stale') return { availability: 'available', timestamp: STALE };
  if (scenario === 'failing') {
    return {
      availability: 'invalid',
      timestamp: FRESH,
      detail: 'Source request failed.',
    };
  }
  return { availability: 'missing', timestamp: null };
}

function buildScenario(scenario: Scenario) {
  const optionalObservation = observation(scenario);
  const readiness = evaluateDraftReadiness({
    sources: {
      'trusted-rankings': { availability: 'available', timestamp: FRESH },
      'canonical-player-identities': { availability: 'available', timestamp: FRESH },
      'primary-league-settings': { availability: 'available', timestamp: FRESH },
      'confirmed-keeper-supply': { availability: 'available', timestamp: FRESH },
      'experimental-predictions': optionalObservation,
      'contract-context': optionalObservation,
      'sportsbook-context': optionalObservation,
    },
  }, NOW);
  const isReady = (key: 'experimental-predictions' | 'contract-context' | 'sportsbook-context') =>
    readiness.optionalSignals.find((item) => item.key === key)?.status === 'ready';
  const optionalSignals: OptionalPlayerSignals = {
    // Data remains present in stale and failing cases to prove readiness, not
    // mere object presence, controls whether an optional input is admitted.
    experimentalPredictions,
    experimentalPredictionsReady: isReady('experimental-predictions'),
    shadowLoggingEnabled: true,
    contractContext,
    contractContextReady: isReady('contract-context'),
    sportsbookSnapshot,
    sportsbookContextReady: isReady('sportsbook-context'),
  };
  const variants = buildRecommendationPlayerVariants(sources, optionalSignals);
  const recommendations = getRecommendations(variants.players, [], 5, {
    architecture: 'best-pick-policy',
    requirements: DEFAULT_ROSTER_REQUIREMENTS,
    rosterCounts: { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 },
    selectionsRemaining: 14,
  });

  return {
    readiness,
    variants,
    decision: {
      bestPick: recommendations.draftNow[0]?.playerId,
      bestPlayer: recommendations.bestAvailable[0]?.playerId,
      bestPickOrder: recommendations.draftNow.map((item) => item.playerId),
      bestPlayerOrder: recommendations.bestAvailable.map((item) => item.playerId),
    },
  };
}

describe('recommendation player product boundary', () => {
  it('keeps live Best Pick and Best Player identical across optional-signal states', () => {
    const scenarios = (['ready', 'absent', 'stale', 'failing'] as const).map(
      buildScenario
    );
    const baseline = scenarios[0]?.decision;

    expect(baseline).toBeDefined();
    for (const scenario of scenarios) {
      expect(scenario.readiness.status).toBe('ready');
      expect(scenario.decision).toEqual(baseline);
      expect(scenario.variants.players.every(
        (player) =>
          player.predictionSource !== 'model' &&
          !player.isContractYear &&
          player.marketAdjustment === undefined
      )).toBe(true);
    }
  });

  it('admits ready predictions only to Shadow Recommendation records', () => {
    const ready = buildScenario('ready');
    const stale = buildScenario('stale');
    const shadowDecision = getRecommendations(
      ready.variants.shadowPlayers,
      [],
      5,
      {
        architecture: 'best-pick-policy',
        requirements: DEFAULT_ROSTER_REQUIREMENTS,
        rosterCounts: { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 },
        selectionsRemaining: 14,
      }
    );

    expect(ready.variants.shadowPlayers).toHaveLength(2);
    expect(ready.variants.shadowPlayers.every(
      (player) => player.predictionSource === 'model'
    )).toBe(true);
    expect(shadowDecision.draftNow[0]?.playerId).toBe('player-2');
    expect(ready.decision.bestPick).toBe('player-1');
    expect(ready.variants.contractContext).toEqual(contractContext);
    expect(ready.variants.sportsbookSnapshot).toBe(sportsbookSnapshot);

    expect(stale.variants.shadowPlayers).toEqual([]);
    expect(stale.variants.contractContext).toEqual([]);
    expect(stale.variants.sportsbookSnapshot).toBeUndefined();
    expect(stale.readiness.optionalSignalDegradations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'experimental-predictions',
          problem: 'stale',
          sourceLabel: 'Experimental prediction artifact',
          timestamp: STALE,
        }),
        expect.objectContaining({ key: 'contract-context', problem: 'stale' }),
        expect.objectContaining({ key: 'sportsbook-context', problem: 'stale' }),
      ])
    );
  });
});
