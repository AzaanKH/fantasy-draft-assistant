import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PICK_EV_LAYERS,
  DEFAULT_ROSTER_REQUIREMENTS,
  optimizeLineupUtility,
  scorePickEvBoard,
  selectPickEvRecommendation,
  type PickEvPlayer,
  type PickEvScore,
} from '@fantasy-draft/shared';

function player(
  id: string,
  position: PickEvPlayer['position'],
  ecrRank: number,
  projectedPoints: number,
  ceilingScore: number = 6
): PickEvPlayer {
  return {
    id,
    position,
    ecrRank,
    projectedPoints,
    marketRank: ecrRank,
    nextPickSurvivalProbability: 0.5,
    ceilingScore,
    uncertaintyScore: 3,
    injuryRiskScore: 2,
  };
}

describe('PickEV lineup utility', () => {
  it('optimizes fixed and FLEX starters from the configured requirements', () => {
    const utility = optimizeLineupUtility([
      player('rb-1', 'RB', 1, 250),
      player('rb-2', 'RB', 2, 225),
      player('rb-3', 'RB', 3, 210),
      player('wr-1', 'WR', 4, 240),
      player('wr-2', 'WR', 5, 220),
      player('wr-3', 'WR', 6, 205),
      player('te-1', 'TE', 7, 190),
    ], DEFAULT_ROSTER_REQUIREMENTS);

    expect(utility).toBe(1540);
  });

  it('keeps risk informational in the default scoring layer', () => {
    const safe = player('safe', 'RB', 10, 240);
    const risky = { ...safe, id: 'risky', injuryRiskScore: 9 };
    const scores = scorePickEvBoard([safe, risky], [], {
      currentPick: 30,
      totalPicks: 150,
      totalTeams: 10,
      requirements: DEFAULT_ROSTER_REQUIREMENTS,
      rosterPlayers: [],
    });

    expect(scores.get('risky')?.riskAdjustedLoss).toBeGreaterThan(0);
    expect(scores.get('risky')?.score).toBe(scores.get('safe')?.score);
  });

  it('adds ceiling option value only through the isolated late-round layer', () => {
    const upside = player('upside', 'WR', 100, 180, 9);
    const context = {
      currentPick: 135,
      totalPicks: 150,
      totalTeams: 10,
      requirements: DEFAULT_ROSTER_REQUIREMENTS,
      rosterPlayers: [],
    };
    const withoutOption = scorePickEvBoard([upside], [], context, {
      ...DEFAULT_PICK_EV_LAYERS,
      lateRoundOptionValue: false,
    });
    const withOption = scorePickEvBoard([upside], [], context, DEFAULT_PICK_EV_LAYERS);

    expect(withoutOption.get('upside')?.lateRoundOptionValue).toBe(0);
    expect(withOption.get('upside')?.lateRoundOptionValue).toBeGreaterThan(0);
  });
});

describe('PickEV ECR champion selection', () => {
  const score = (value: number): PickEvScore => ({
    score: value,
    ecrAnchorValue: value,
    projectionResidualValue: 0,
    marginalRosterValue: 0,
    costOfWaiting: 0,
    lateRoundOptionValue: 0,
    riskAdjustedLoss: 0,
    replacementPoints: 0,
    dynamicValueOverReplacement: 0,
    expectedNextPickAlternativeValue: 0,
  });

  it('retains ECR until an in-guardrail challenger clears the threshold', () => {
    const champion = player('champion', 'WR', 20, 200);
    const challenger = player('challenger', 'RB', 25, 215);
    const scores = new Map([
      ['champion', score(100)],
      ['challenger', score(105)],
    ]);

    expect(selectPickEvRecommendation([champion, challenger], scores, false, 4)).toMatchObject({
      playerId: 'champion',
      overridden: false,
    });
    expect(selectPickEvRecommendation([champion, challenger], scores, true, 4)).toMatchObject({
      playerId: 'challenger',
      overridden: true,
      overrideAdvantage: 5,
    });
  });
});
