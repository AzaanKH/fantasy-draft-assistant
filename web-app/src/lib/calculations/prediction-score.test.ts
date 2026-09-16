import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROSTER_REQUIREMENTS,
  type Player,
  type RosterRequirements,
} from '@fantasy-draft/shared';
import { applyDynamicValueOverReplacement } from './prediction-score';

function createRunningBack(rank: number): Player {
  return {
    id: `rb-${String(rank)}`,
    name: `Running Back ${String(rank)}`,
    position: 'RB',
    team: 'DET',
    byeWeek: 5,
    ecrRank: rank,
    positionalRank: rank,
    sleeperAdp: rank,
    valueScore: 0,
    marketRank: rank,
    marketAdp: rank,
    marketAdpTrend: 0,
    isContractYear: false,
    offensiveEnvironmentScore: 5,
    projectedPoints: 101 - rank,
    valueOverReplacement: 0,
    tier: 1,
    tierDropoffScore: 0,
    nextPickSurvivalProbability: 0.5,
    ceilingScore: 5,
    floorScore: 5,
    upsideScore: 5,
    uncertaintyScore: 3,
    injuryRiskScore: 2,
    predictionSource: 'fantasypros',
    newsStatus: 'healthy',
    stackPartnerTeam: 'DET',
    highlightLevel: 'neutral',
  };
}

function requirements(rbStarters: number, flexStarters: number): RosterRequirements {
  return {
    ...DEFAULT_ROSTER_REQUIREMENTS,
    RB: { starters: rbStarters, max: 20 },
    FLEX: { starters: flexStarters, eligiblePositions: ['RB'] },
  };
}

describe('applyDynamicValueOverReplacement', () => {
  it('moves replacement level when Sleeper starter and flex counts change', () => {
    const players = Array.from({ length: 25 }, (_, index) =>
      createRunningBack(index + 1)
    );
    const oneRb = applyDynamicValueOverReplacement(
      players,
      10,
      requirements(1, 0)
    );
    const oneRbAndFlex = applyDynamicValueOverReplacement(
      players,
      10,
      requirements(1, 1)
    );

    expect(oneRb[0]?.valueOverReplacement).toBe(10);
    expect(oneRbAndFlex[0]?.valueOverReplacement).toBe(20);
  });
});
