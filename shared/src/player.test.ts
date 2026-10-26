import { asProbability, asRank, asVor } from './units/brands.js';
import { describe, expect, it } from 'vitest';
import {
  isNFLTeam,
  isPlayer,
  isPosition,
  isPredictionSource,
  isNewsStatus,
  NFL_TEAMS,
  type Player,
} from './player.js';
import { isTeamEnvironment } from './catalog/decoders.js';
import { isNeedPriority } from './draft.js';
import {
  isTopOffense,
  isDecentOffense,
  type TeamEnvironment,
} from './team-environment.js';

const player: Player = {
  id: 'p1',
  name: 'Player One',
  position: 'WR',
  team: 'DET',
  byeWeek: 8,
  ecrRank: asRank(12),
  positionalRank: asRank(5),
  sleeperAdp: 13.5,
  valueScore: 1.5,
  marketRank: 14,
  marketAdp: 13.5,
  marketAdpTrend: 0,
  isContractYear: false,
  offensiveEnvironmentScore: 8,
  projectedPoints: 260.4,
  valueOverReplacement: asVor(88.1),
  tier: 2,
  tierDropoffScore: 0.4,
  nextPickSurvivalProbability: asProbability(0.2),
  ceilingScore: 80,
  floorScore: 60,
  upsideScore: 70,
  uncertaintyScore: 30,
  injuryRiskScore: 10,
  predictionSource: 'model',
  newsStatus: 'healthy',
  stackPartnerTeam: 'DET',
  highlightLevel: 'neutral',
};

describe('player validation', () => {
  it('recognizes fantasy positions and all 32 NFL teams', () => {
    expect(['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].every(isPosition)).toBe(true);
    expect(isPosition('FLEX')).toBe(false);
    expect(isPosition('wr')).toBe(false);
    expect(NFL_TEAMS).toHaveLength(32);
    expect(NFL_TEAMS.every(isNFLTeam)).toBe(true);
    expect(isNFLTeam('FA')).toBe(false);
  });

  it('accepts a player with only required fields and with optional fields', () => {
    expect(isPlayer(player)).toBe(true);
    expect(isPlayer({
      ...player,
      sleeperSearchRank: 20,
      tierSource: 'league-projection',
      survivalModelSource: 'league-history',
      nextPickLabel: 'Pick 2.08',
      leaguePositionTendency: 'early',
    })).toBe(true);
  });

  it.each([
    ['an unknown position', { position: 'LB' }],
    ['an unknown team', { team: 'LON' }],
    ['a string ECR rank', { ecrRank: '12' }],
    ['a missing projection', { projectedPoints: undefined }],
    ['a non-boolean contract flag', { isContractYear: 'no' }],
    ['an unknown prediction source', { predictionSource: 'guess' }],
    ['an unknown news status', { newsStatus: 'rumored' }],
    ['an unknown highlight level', { highlightLevel: 'must-draft' }],
    ['an unknown tier source', { tierSource: 'vibes' }],
    ['an unknown survival model source', { survivalModelSource: 'oracle' }],
    ['a string optional number', { consensusAdp: '15' }],
  ])('rejects a player with %s', (_label, overrides) => {
    expect(isPlayer({ ...player, ...overrides })).toBe(false);
  });

  it('rejects non-object input', () => {
    for (const value of [null, undefined, 'p1', 1, true]) {
      expect(isPlayer(value)).toBe(false);
    }
  });
});

describe('team environment', () => {
  const environment: TeamEnvironment = {
    team: 'DET',
    name: 'Detroit Lions',
    offenseScore: 8,
    passVolume: 'high',
    rushVolume: 'medium',
    pointsRank: 1,
    passAttemptsRank: 10,
    rushAttemptsRank: 5,
    coachingStability: true,
  };

  it('validates the environment structure', () => {
    expect(isTeamEnvironment(environment)).toBe(true);
    expect(isTeamEnvironment({ ...environment, passVolume: 'extreme' })).toBe(false);
    expect(isTeamEnvironment({ ...environment, coachingStability: 'yes' })).toBe(false);
    expect(isTeamEnvironment(null)).toBe(false);
  });

  it('classifies offenses at the 8 and 6 score thresholds', () => {
    expect(isTopOffense(environment)).toBe(true);
    expect(isTopOffense({ ...environment, offenseScore: 7.9 })).toBe(false);
    expect(isDecentOffense({ ...environment, offenseScore: 6 })).toBe(true);
    expect(isDecentOffense({ ...environment, offenseScore: 5.9 })).toBe(false);
  });
});


describe('elementary enum predicates', () => {
  it('accepts each supported prediction source, news status, and need priority', () => {
    expect(['model', 'fantasypros', 'heuristic'].every(isPredictionSource)).toBe(true);
    expect(['healthy', 'limited', 'questionable', 'out', 'unknown'].every(isNewsStatus)).toBe(true);
    expect(['critical', 'high', 'medium', 'low', 'defer', 'filled'].every(isNeedPriority)).toBe(true);
  });

  it('rejects non-string and unknown enum members', () => {
    for (const predicate of [isPosition, isNFLTeam, isPredictionSource, isNewsStatus, isNeedPriority]) {
      for (const value of [undefined, null, 1, {}, [], 'not-supported']) expect(predicate(value)).toBe(false);
    }
  });

  it('rejects arrays carrying player fields because the declared player boundary is an object', () => {
    expect(isPlayer(Object.assign([], player))).toBe(false);
  });

  it('preserves player numeric acceptance and optional fields not checked by the existing guard', () => {
    expect(isPlayer({ ...player, ecrRank: asRank(Number.NaN), consensusAdp: Number.POSITIVE_INFINITY })).toBe(true);
    expect(isPlayer({ ...player, contractEndYear: 'unchecked', customProjectedPoints: 'unchecked' })).toBe(true);
  });
});
