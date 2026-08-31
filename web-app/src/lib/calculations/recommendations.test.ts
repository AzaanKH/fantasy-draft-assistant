import { describe, it, expect } from 'vitest';
import { getRecommendations, getTopRecommendation } from './recommendations';
import {
  DEFAULT_ROSTER_REQUIREMENTS,
  DEFAULT_SCORING_RULES,
  type FantasyProsProjection,
  type Player,
  type PositionNeed,
} from '@fantasy-draft/shared';
import { calculateLeagueProjection } from './league-scoring';

// Helper to create a mock player
function createPlayer(
  id: string,
  position: Player['position'],
  ecrRank: number,
  name?: string
): Player {
  return {
    id,
    name: name ?? `Player ${id}`,
    position,
    team: 'DET',
    byeWeek: 6,
    ecrRank,
    positionalRank: ecrRank,
    sleeperAdp: ecrRank,
    valueScore: 0,
    marketRank: ecrRank,
    marketAdp: ecrRank,
    marketAdpTrend: 0,
    isContractYear: false,
    offensiveEnvironmentScore: 5,
    projectedPoints: 200 - ecrRank,
    valueOverReplacement: Math.max(0, 20 - ecrRank / 5),
    tier: 1,
    tierDropoffScore: 0.8,
    nextPickSurvivalProbability: 0.5,
    ceilingScore: 7,
    floorScore: 6,
    upsideScore: 6,
    uncertaintyScore: 3,
    injuryRiskScore: 2,
    predictionSource: 'heuristic',
    newsStatus: 'healthy',
    stackPartnerTeam: 'DET',
    highlightLevel: 'neutral',
  };
}

// Helper to create position needs
function createNeeds(
  needsConfig: Array<{
    position: Player['position'];
    priority: PositionNeed['priority'];
    scarcityScore?: number;
  }>
): PositionNeed[] {
  return needsConfig.map(({ position, priority, scarcityScore = 5 }) => ({
    position,
    priority,
    startersFilled: priority === 'critical' ? 0 : 1,
    startersNeeded: position === 'QB' ? 1 : 2,
    flexSlotsFilled: 0,
    flexSlotsNeeded: 0,
    isFlexEligible: false,
    scarcityScore,
  }));
}

describe('getRecommendations', () => {
  describe('Primary League Best Pick policy', () => {
    it('uses full-PPR projections, TE premium, rush attempts, and replacement value inside the conservative window', () => {
      const projection = (
        name: string,
        position: Player['position'],
        projectedReceptions: number,
        projectedRushAttempts: number
      ): FantasyProsProjection => ({
        name,
        position,
        team: 'DET',
        projectedPoints: 200,
        baseProjectedPoints: 200,
        projectedReceptions,
        projectedRushAttempts,
      });
      const wrProjection = calculateLeagueProjection(
        projection('ECR WR', 'WR', 80, 0),
        'WR',
        DEFAULT_SCORING_RULES
      );
      const teProjection = calculateLeagueProjection(
        projection('Premium TE', 'TE', 80, 0),
        'TE',
        DEFAULT_SCORING_RULES
      );
      const rbProjection = calculateLeagueProjection(
        projection('Volume RB', 'RB', 40, 200),
        'RB',
        DEFAULT_SCORING_RULES
      );
      const players = [
        {
          ...createPlayer('ecr-wr', 'WR', 1, 'ECR WR'),
          projectedPoints: wrProjection.projectedPoints,
          leagueScoringAdjustment: wrProjection.adjustment,
          valueOverReplacement: wrProjection.projectedPoints - 100,
        },
        {
          ...createPlayer('premium-te', 'TE', 2, 'Premium TE'),
          projectedPoints: teProjection.projectedPoints,
          leagueScoringAdjustment: teProjection.adjustment,
          valueOverReplacement: teProjection.projectedPoints - 100,
        },
        {
          ...createPlayer('volume-rb', 'RB', 3, 'Volume RB'),
          projectedPoints: rbProjection.projectedPoints,
          leagueScoringAdjustment: rbProjection.adjustment,
          valueOverReplacement: rbProjection.projectedPoints - 100,
        },
      ];

      const result = getRecommendations(players, [], 10, {
        architecture: 'best-pick-policy',
        requirements: DEFAULT_ROSTER_REQUIREMENTS,
        rosterCounts: {},
        selectionsRemaining: 14,
      });

      expect(wrProjection.adjustment).toBe(0);
      expect(teProjection.adjustment).toBe(40);
      expect(rbProjection.adjustment).toBe(40);
      expect(result.draftNow[0]?.playerId).toBe('premium-te');
      expect(result.bestAvailable[0]?.playerId).toBe('ecr-wr');
      expect(result.selection).toMatchObject({
        preferredPlayerId: 'premium-te',
        policy: 'primary-league-policy',
        ecrNeighborhood: 8,
        feasibilityException: false,
      });
      expect(result.draftNow[0]?.decisionFactors).toMatchObject({
        playerQuality: { ecrRank: 2, score: -2 },
        leagueValue: {
          score: 5.83,
          minScore: 0,
          maxScore: 6,
          scoringAdjustment: 40,
          replacementPoints: 100,
          materiallyChangedOrdering: true,
        },
        rosterFit: {
          score: 6,
          minScore: 0,
          maxScore: 8,
          fixedStartersOpen: 7,
          flexSlotsOpen: 2,
          benchSlotsOpen: 5,
          selectionsRemaining: 14,
          legalCompletionPossible: true,
        },
        conservativeBoundary: {
          withinBoundary: true,
          feasibilityException: false,
        },
      });
    });

    it('accounts for FLEX eligibility and bench depth', () => {
      const backupQuarterback = {
        ...createPlayer('backup-qb', 'QB', 1, 'Backup QB'),
        valueOverReplacement: 0,
      };
      const flexReceiver = {
        ...createPlayer('flex-wr', 'WR', 3, 'Flex WR'),
        valueOverReplacement: 0,
      };
      const result = getRecommendations(
        [backupQuarterback, flexReceiver],
        [],
        10,
        {
          architecture: 'best-pick-policy',
          requirements: DEFAULT_ROSTER_REQUIREMENTS,
          rosterCounts: { QB: 1, RB: 3, WR: 2, TE: 1, K: 1, DEF: 0 },
          selectionsRemaining: 6,
        }
      );

      expect(result.draftNow[0]?.playerId).toBe('flex-wr');
      expect(result.draftNow.find((pick) => pick.playerId === 'backup-qb')
        ?.decisionFactors?.rosterFit.score).toBe(1);
      expect(result.draftNow.find((pick) => pick.playerId === 'flex-wr')
        ?.decisionFactors?.rosterFit).toMatchObject({
          score: 4,
          fixedStartersOpen: 0,
          flexSlotsOpen: 1,
          benchSlotsOpen: 5,
          materiallyChangedOrdering: true,
      });
    });

    it('uses a meaningful tier cliff as bounded cost of waiting without changing Best Player', () => {
      const ecrAnchor = {
        ...createPlayer('ecr-anchor', 'WR', 1, 'ECR Anchor'),
        projectedPoints: 210,
        valueOverReplacement: 0,
      };
      const lastRunningBack = {
        ...createPlayer('last-rb', 'RB', 3, 'Last Tier RB'),
        projectedPoints: 220,
        valueOverReplacement: 0,
        tier: 1,
        tierDropoffScore: 0.8,
      };
      const nextTierRunningBack = {
        ...createPlayer('next-tier-rb', 'RB', 20, 'Next Tier RB'),
        projectedPoints: 180,
        valueOverReplacement: 0,
        tier: 2,
      };
      const result = getRecommendations(
        [ecrAnchor, lastRunningBack, nextTierRunningBack],
        [],
        10,
        {
          architecture: 'best-pick-policy',
          requirements: DEFAULT_ROSTER_REQUIREMENTS,
          rosterCounts: {},
          selectionsRemaining: 14,
        }
      );

      expect(result.draftNow[0]?.playerId).toBe('last-rb');
      expect(result.bestAvailable.map((pick) => pick.playerId)).toEqual([
        'ecr-anchor',
        'last-rb',
        'next-tier-rb',
      ]);
      expect(result.draftNow[0]?.decisionFactors?.tierSupply).toEqual({
        score: 4,
        minScore: 0,
        maxScore: 4,
        currentTier: 1,
        remainingInTier: 1,
        nextTier: 2,
        nextTierProjectedPoints: 180,
        dropoffPoints: 40,
        meaningfulCliff: true,
        costOfWaiting: 4,
        materiallyChangedOrdering: true,
      });
      expect(result.draftNow[0]?.diagnostics).toMatchObject({
        tierRemaining: 1,
        tierDropoffPoints: 40,
        costOfWaiting: 4,
      });
      expect(result.draftNow[0]?.reason).toContain('tier wait cost +4.0/4');
      expect(result.draftNow[0]?.decisionFactors?.conservativeBoundary)
        .toMatchObject({
          withinBoundary: true,
          feasibilityException: false,
        });
    });

    it('reduces tier cost of waiting when interchangeable players remain', () => {
      const players = [
        {
          ...createPlayer('ecr-anchor', 'WR', 1, 'ECR Anchor'),
          valueOverReplacement: 0,
        },
        {
          ...createPlayer('tier-rb-one', 'RB', 3, 'Tier RB One'),
          projectedPoints: 220,
          valueOverReplacement: 0,
          tier: 1,
          tierDropoffScore: 0.8,
        },
        {
          ...createPlayer('tier-rb-two', 'RB', 4, 'Tier RB Two'),
          projectedPoints: 219,
          valueOverReplacement: 0,
          tier: 1,
          tierDropoffScore: 0.8,
        },
        {
          ...createPlayer('next-tier-rb', 'RB', 20, 'Next Tier RB'),
          projectedPoints: 180,
          valueOverReplacement: 0,
          tier: 2,
        },
      ];
      const result = getRecommendations(players, [], 10, {
        architecture: 'best-pick-policy',
        requirements: DEFAULT_ROSTER_REQUIREMENTS,
        rosterCounts: {},
        selectionsRemaining: 14,
      });
      const tierFactor = result.draftNow.find(
        (pick) => pick.playerId === 'tier-rb-one'
      )?.decisionFactors?.tierSupply;

      expect(tierFactor).toMatchObject({
        remainingInTier: 2,
        dropoffPoints: 39,
        costOfWaiting: 2.44,
      });
      expect(tierFactor?.costOfWaiting).toBeLessThan(4);
    });

    it('ignores an ordinary gap even when the tier number changes', () => {
      const ecrAnchor = {
        ...createPlayer('ecr-anchor', 'WR', 1, 'ECR Anchor'),
        valueOverReplacement: 0,
      };
      const currentTierRunningBack = {
        ...createPlayer('current-tier-rb', 'RB', 2, 'Current Tier RB'),
        projectedPoints: 220,
        valueOverReplacement: 0,
        tier: 1,
        tierDropoffScore: 0.8,
      };
      const nextTierRunningBack = {
        ...createPlayer('next-tier-rb', 'RB', 20, 'Next Tier RB'),
        projectedPoints: 216,
        valueOverReplacement: 0,
        tier: 2,
      };
      const result = getRecommendations(
        [ecrAnchor, currentTierRunningBack, nextTierRunningBack],
        [],
        10,
        {
          architecture: 'best-pick-policy',
          requirements: DEFAULT_ROSTER_REQUIREMENTS,
          rosterCounts: {},
          selectionsRemaining: 14,
        }
      );
      const tierFactor = result.draftNow.find(
        (pick) => pick.playerId === 'current-tier-rb'
      )?.decisionFactors?.tierSupply;

      expect(result.draftNow[0]?.playerId).toBe('ecr-anchor');
      expect(tierFactor).toMatchObject({
        remainingInTier: 1,
        dropoffPoints: 4,
        meaningfulCliff: false,
        score: 0,
        costOfWaiting: 0,
        materiallyChangedOrdering: false,
      });
    });

    it('lets the bounded next-pick tradeoff change Best Pick without changing Best Player', () => {
      const nextPickContext = {
        nextPickNumber: 13,
        nextPickLabel: '2.03',
        picksUntilNextPick: 5,
        survivalModelSource: 'league-history' as const,
      };
      const ecrAnchor = {
        ...createPlayer('ecr-anchor', 'WR', 1, 'ECR Anchor'),
        valueOverReplacement: 0,
        nextPickSurvivalProbability: 0.7,
        ...nextPickContext,
      };
      const urgentRunningBack = {
        ...createPlayer('urgent-rb', 'RB', 3, 'Urgent RB'),
        valueOverReplacement: 24,
        nextPickSurvivalProbability: 0.05,
        ...nextPickContext,
      };
      const fallbackOne = {
        ...createPlayer('fallback-one', 'RB', 20, 'Fallback One'),
        valueOverReplacement: 8,
        nextPickSurvivalProbability: 0.8,
        ...nextPickContext,
      };
      const fallbackTwo = {
        ...createPlayer('fallback-two', 'RB', 21, 'Fallback Two'),
        valueOverReplacement: 6,
        nextPickSurvivalProbability: 0.9,
        ...nextPickContext,
      };
      const players = [ecrAnchor, urgentRunningBack, fallbackOne, fallbackTwo];
      const context = {
        architecture: 'best-pick-policy' as const,
        requirements: DEFAULT_ROSTER_REQUIREMENTS,
        rosterCounts: {},
        selectionsRemaining: 14,
      };

      const result = getRecommendations(players, [], 10, context);
      const urgent = result.draftNow.find((pick) => pick.playerId === 'urgent-rb');
      const afterFallbackPick = getRecommendations(
        players.filter((player) => player.id !== 'fallback-one'),
        [],
        10,
        context
      );

      expect(result.draftNow[0]?.playerId).toBe('urgent-rb');
      expect(result.bestAvailable[0]?.playerId).toBe('ecr-anchor');
      expect(urgent?.decisionFactors?.draftTiming).toMatchObject({
        nextPickNumber: 13,
        nextPickLabel: '2.03',
        returnProbability: 0.05,
        candidateValue: 24,
        costOfWaiting: 16.7,
        score: 2.09,
        maxScore: 4,
        materiallyChangedOrdering: true,
        expectedAlternative: {
          playerId: 'fallback-one',
          playerName: 'Fallback One',
          expectedValue: 6.4,
        },
      });
      expect(urgent?.decisionFactors?.conservativeBoundary.withinBoundary).toBe(true);
      expect(urgent?.diagnostics).toMatchObject({
        nextPickNumber: 13,
        nextPickLabel: '2.03',
        expectedNextPickAlternativeValue: 6.4,
        nextPickCostOfWaiting: 16.7,
      });
      expect(afterFallbackPick.draftNow.find((pick) => pick.playerId === 'urgent-rb')
        ?.decisionFactors?.draftTiming.expectedAlternative?.playerId).toBe('fallback-two');
    });

    it('does not project past the final manager selection', () => {
      const noHorizon = {
        ...createPlayer('no-horizon-rb', 'RB', 3, 'No Horizon RB'),
        valueOverReplacement: 24,
        nextPickSurvivalProbability: 0,
        survivalModelSource: 'heuristic' as const,
      };
      const result = getRecommendations(
        [
          {
            ...createPlayer('ecr-anchor', 'WR', 1, 'ECR Anchor'),
            valueOverReplacement: 0,
            survivalModelSource: 'heuristic' as const,
          },
          noHorizon,
        ],
        [],
        10,
        {
          architecture: 'best-pick-policy',
          requirements: DEFAULT_ROSTER_REQUIREMENTS,
          rosterCounts: {},
          selectionsRemaining: 1,
        }
      );
      const factor = result.draftNow.find((pick) => pick.playerId === noHorizon.id)
        ?.decisionFactors?.draftTiming;

      expect(factor).toMatchObject({
        score: 0,
        costOfWaiting: 0,
        materiallyChangedOrdering: false,
      });
      expect(factor?.nextPickNumber).toBeUndefined();
      expect(result.bestAvailable[0]?.playerId).toBe('ecr-anchor');
    });

    it('does not let bounded league and roster factors reach past the ECR window', () => {
      const ecrAnchor = {
        ...createPlayer('ecr-anchor', 'WR', 1, 'ECR Anchor'),
        valueOverReplacement: 0,
      };
      const outsideRunningBack = {
        ...createPlayer('outside-rb', 'RB', 10, 'Outside RB'),
        projectedPoints: 300,
        valueOverReplacement: 500,
        tier: 1,
        tierDropoffScore: 1,
      };
      const nextTierRunningBack = {
        ...createPlayer('next-tier-rb', 'RB', 20, 'Next Tier RB'),
        projectedPoints: 200,
        valueOverReplacement: 0,
        tier: 2,
      };
      const result = getRecommendations(
        [ecrAnchor, outsideRunningBack, nextTierRunningBack],
        [],
        10,
        {
          architecture: 'best-pick-policy',
          requirements: DEFAULT_ROSTER_REQUIREMENTS,
          rosterCounts: { WR: 4 },
          selectionsRemaining: 10,
        }
      );

      expect(result.draftNow.find((pick) => pick.playerId === 'outside-rb')
        ?.score).toBeGreaterThan(result.draftNow[0]?.score ?? 0);
      expect(result.draftNow.find((pick) => pick.playerId === 'outside-rb')
        ?.decisionFactors?.conservativeBoundary.withinBoundary).toBe(false);
      expect(result.draftNow.find((pick) => pick.playerId === 'outside-rb')
        ?.decisionFactors?.tierSupply).toMatchObject({
          score: 4,
          maxScore: 4,
          meaningfulCliff: true,
        });
      expect(result.draftNow[0]?.playerId).toBe('ecr-anchor');
      expect(result.selection.policy).toBe('primary-league-policy');
    });

    it('uses deterministic ECR, name, and ID tie-breaking', () => {
      const result = getRecommendations(
        [
          createPlayer('z-id', 'WR', 1, 'Zed Receiver'),
          createPlayer('b-id', 'WR', 1, 'Alpha Receiver'),
          createPlayer('a-id', 'WR', 1, 'Alpha Receiver'),
          {
            ...createPlayer('next-tier', 'WR', 40, 'Next Tier'),
            projectedPoints: 150,
            tier: 2,
          },
        ],
        [],
        10,
        {
          architecture: 'best-pick-policy',
          requirements: DEFAULT_ROSTER_REQUIREMENTS,
          rosterCounts: {},
          selectionsRemaining: 14,
        }
      );

      expect(result.draftNow.map((pick) => pick.playerId)).toEqual([
        'a-id',
        'b-id',
        'z-id',
        'next-tier',
      ]);
      expect(result.draftNow.slice(0, 3).map((pick) =>
        pick.decisionFactors?.tierSupply.score
      )).toEqual([2.04, 2.04, 2.04]);
    });

    it('crosses the normal boundary only to preserve a legal completed roster', () => {
      const maxedTightEnd = createPlayer('maxed-te', 'TE', 1, 'Maxed TE');
      const boundedReceiver = createPlayer('bounded-wr', 'WR', 4, 'Bounded WR');
      const requiredKicker = createPlayer('required-k', 'K', 30, 'Required Kicker');
      const result = getRecommendations(
        [maxedTightEnd, boundedReceiver, requiredKicker],
        [],
        10,
        {
          architecture: 'best-pick-policy',
          currentPick: 140,
          totalPicks: 140,
          requirements: DEFAULT_ROSTER_REQUIREMENTS,
          rosterCounts: { QB: 2, RB: 5, WR: 3, TE: 3, K: 0, DEF: 0 },
          selectionsRemaining: 1,
        }
      );

      expect(result.bestAvailable[0]?.playerId).toBe('maxed-te');
      expect(result.draftNow.some((pick) => pick.playerId === 'maxed-te')).toBe(false);
      expect(result.draftNow[0]?.playerId).toBe('required-k');
      expect(result.selection).toMatchObject({
        preferredPlayerId: 'required-k',
        policy: 'roster-feasibility',
        feasibilityException: true,
      });
      expect(result.draftNow[0]?.decisionFactors).toMatchObject({
        rosterFit: {
          selectionsRemaining: 1,
          legalCompletionPossible: true,
        },
        conservativeBoundary: {
          ecrRankLimit: 9,
          withinBoundary: false,
          feasibilityException: true,
        },
      });
      expect(result.draftNow.find((pick) => pick.playerId === 'bounded-wr')
        ?.decisionFactors?.rosterFit.legalCompletionPossible).toBe(false);
    });
  });

  describe('PickEV architecture', () => {
    it('uses ADP through survival rather than adding market rank to player quality', () => {
      const base = {
        ...createPlayer('same-quality-a', 'WR', 20),
        projectedPoints: 220,
        marketRank: 20,
        nextPickSurvivalProbability: 0.5,
      };
      const marketOnlyDifference = {
        ...base,
        id: 'same-quality-b',
        marketRank: 80,
      };
      const needs = createNeeds([{ position: 'WR', priority: 'critical' }]);

      const { draftNow } = getRecommendations(
        [base, marketOnlyDifference],
        needs,
        10,
        {
          architecture: 'pick-ev',
          currentPick: 20,
          totalPicks: 150,
          totalTeams: 10,
          rosterCounts: { WR: 0 },
        }
      );

      expect(draftNow[0]?.score).toBe(draftNow[1]?.score);
      expect(draftNow[0]?.subScores?.marketValueScore).toBe(0);
    });

    it('turns a likely tier loss into cost of waiting and reports risk as lost utility', () => {
      const urgent = {
        ...createPlayer('urgent-rb', 'RB', 20),
        projectedPoints: 260,
        nextPickSurvivalProbability: 0.1,
        injuryRiskScore: 7,
        uncertaintyScore: 6,
      };
      const fallback = {
        ...createPlayer('fallback-rb', 'RB', 28),
        projectedPoints: 200,
        nextPickSurvivalProbability: 0.9,
      };
      const needs = createNeeds([{ position: 'RB', priority: 'critical' }]);

      const { draftNow, selection } = getRecommendations([urgent, fallback], needs, 10, {
        architecture: 'pick-ev',
        currentPick: 25,
        totalPicks: 150,
        totalTeams: 10,
        rosterCounts: { RB: 0 },
      });
      const recommendation = draftNow.find((candidate) => candidate.playerId === 'urgent-rb');

      expect(recommendation?.subScores?.costOfWaiting).toBeGreaterThan(0);
      expect(recommendation?.subScores?.riskAdjustedLoss).toBeGreaterThan(0);
      expect(recommendation?.reason).toContain('ECR champion');
      expect(recommendation?.reason).toContain('risk info');
      expect(recommendation?.diagnostics?.replacementPoints).toBeDefined();
      expect(selection).toMatchObject({
        preferredPlayerId: draftNow[0]?.playerId,
        policy: 'ecr-anchor',
      });
    });

    it('removes positions disabled by user requirements from policy lists without redefining Best Player', () => {
      const result = getRecommendations(
        [createPlayer('defense', 'DEF', 1), createPlayer('receiver', 'WR', 20)],
        createNeeds([
          { position: 'DEF', priority: 'filled' },
          { position: 'WR', priority: 'critical' },
        ]),
        10,
        {
          architecture: 'pick-ev',
          currentPick: 130,
          totalPicks: 150,
          totalTeams: 10,
          requirements: DEFAULT_ROSTER_REQUIREMENTS,
          rosterCounts: { DEF: 0, WR: 0 },
        }
      );

      const allRecommendations = [
        ...result.draftNow,
        ...result.marketValues,
        ...result.marketStashes,
        ...result.byNeed,
      ];
      expect(allRecommendations.some((recommendation) =>
        recommendation.position === 'DEF'
      )).toBe(false);
      expect(result.bestAvailable[0]?.playerId).toBe('defense');
    });
  });

  describe('draftNow', () => {
    it('combines prediction value, roster need, scarcity, market value, and survival', () => {
      const players = [
        {
          ...createPlayer('value-rb', 'RB', 35),
          valueScore: 14,
          marketRank: 49,
          marketAdp: 49,
          valueOverReplacement: 25,
          nextPickSurvivalProbability: 0.18,
          predictionSource: 'model' as const,
        },
        {
          ...createPlayer('safe-wr', 'WR', 22),
          valueScore: 0,
          valueOverReplacement: 10,
          nextPickSurvivalProbability: 0.85,
        },
      ];
      const needs = createNeeds([
        { position: 'RB', priority: 'critical', scarcityScore: 8 },
        { position: 'WR', priority: 'low', scarcityScore: 2 },
      ]);

      const { draftNow } = getRecommendations(players, needs, 10, {
        currentPick: 25,
        totalPicks: 150,
        isMyTurn: true,
      });

      expect(draftNow[0]?.playerName).toBe('Player value-rb');
      expect(draftNow[0]?.reason).toContain('critical roster need');
      expect(draftNow[0]?.reason).toContain('VOR 25.0');
      expect(draftNow[0]?.reason).toContain('Steal +14');
      expect(draftNow[0]?.reason).toContain('unlikely to survive');
      expect(draftNow[0]?.subScores?.rosterNeedScore).toBe(34);
      expect(draftNow[0]?.subScores?.scarcityScore).toBeGreaterThan(0);
      expect(draftNow[0]?.subScores?.draftStateScore).toBeGreaterThan(0);
    });

    it('penalizes kicker and defense recommendations before the late rounds', () => {
      const players = [
        createPlayer('k1', 'K', 5),
        createPlayer('rb1', 'RB', 45),
      ];
      const needs = createNeeds([
        { position: 'K', priority: 'critical', scarcityScore: 8 },
        { position: 'RB', priority: 'medium', scarcityScore: 5 },
      ]);

      const early = getRecommendations(players, needs, 10, {
        currentPick: 20,
        totalPicks: 150,
      }).draftNow;
      const late = getRecommendations(players, needs, 10, {
        currentPick: 125,
        totalPicks: 150,
      }).draftNow;

      expect(early[0]?.position).toBe('RB');
      expect(early.some((rec) => rec.position === 'K')).toBe(false);
      expect(late.find((rec) => rec.position === 'K')?.subScores?.draftStateScore)
        .toBeGreaterThan(0);
    });

    it('caps malformed special-teams VOR before scoring recommendations', () => {
      const players = [
        {
          ...createPlayer('bad-kicker', 'K', 403),
          projectedPoints: 126,
          valueOverReplacement: 126,
          predictionSource: 'model' as const,
        },
        createPlayer('rb1', 'RB', 45),
      ];
      const needs = createNeeds([
        { position: 'K', priority: 'critical', scarcityScore: 8 },
        { position: 'RB', priority: 'medium', scarcityScore: 5 },
      ]);

      const draftNow = getRecommendations(players, needs, 10, {
        currentPick: 125,
        totalPicks: 150,
      }).draftNow;
      const kicker = draftNow.find((recommendation) => recommendation.playerId === 'bad-kicker');

      expect(kicker?.subScores?.replacementScore).toBe(75);
      expect(kicker?.diagnostics?.valueOverReplacement).toBe(20);
      expect(kicker?.reason).toContain('VOR 20.0');
    });

    it('defers special teams from policy lists but preserves the ECR-only Best Player order', () => {
      const players = [
        {
          ...createPlayer('k1', 'K', 186),
          valueScore: 813,
          marketRank: 999,
          marketAdp: 999,
          projectedPoints: 153,
          valueOverReplacement: 153,
        },
        {
          ...createPlayer('def1', 'DEF', 190),
          valueScore: 809,
          marketRank: 999,
          marketAdp: 999,
          projectedPoints: 140,
          valueOverReplacement: 140,
        },
        createPlayer('rb1', 'RB', 8),
        createPlayer('wr1', 'WR', 12),
      ];
      const needs = createNeeds([
        { position: 'K', priority: 'critical', scarcityScore: 10 },
        { position: 'DEF', priority: 'critical', scarcityScore: 10 },
        { position: 'RB', priority: 'critical', scarcityScore: 5 },
        { position: 'WR', priority: 'critical', scarcityScore: 5 },
      ]);

      const recommendations = getRecommendations(players, needs, 10, {
        currentPick: 7,
        totalPicks: 150,
      });

      expect(recommendations.draftNow.some((rec) => rec.position === 'K')).toBe(false);
      expect(recommendations.draftNow.some((rec) => rec.position === 'DEF')).toBe(false);
      expect(recommendations.bestAvailable.map((rec) => rec.position)).toEqual([
        'RB',
        'WR',
        'K',
        'DEF',
      ]);
      expect(recommendations.marketValues.some((rec) => rec.position === 'K')).toBe(false);
      expect(recommendations.marketValues.some((rec) => rec.position === 'DEF')).toBe(false);
      expect(recommendations.marketStashes.some((rec) => rec.position === 'K')).toBe(false);
      expect(recommendations.marketStashes.some((rec) => rec.position === 'DEF')).toBe(false);
      expect(recommendations.byNeed.some((rec) => rec.position === 'K')).toBe(false);
      expect(recommendations.byNeed.some((rec) => rec.position === 'DEF')).toBe(false);
    });

    it('applies a smaller uncertainty penalty separately from availability risk', () => {
      const players = [
        {
          ...createPlayer('stable-wr', 'WR', 20),
          uncertaintyScore: 2,
          injuryRiskScore: 4,
        },
        {
          ...createPlayer('uncertain-wr', 'WR', 20),
          uncertaintyScore: 8,
          injuryRiskScore: 4,
        },
      ];
      const needs = createNeeds([{ position: 'WR', priority: 'medium' }]);

      const { draftNow } = getRecommendations(players, needs, 10);
      const stable = draftNow.find((rec) => rec.playerId === 'stable-wr');
      const uncertain = draftNow.find((rec) => rec.playerId === 'uncertain-wr');

      expect(stable?.subScores?.riskPenalty).toBe(4);
      expect(stable?.subScores?.uncertaintyPenalty).toBe(0.7);
      expect(uncertain?.subScores?.uncertaintyPenalty).toBe(2.8);
      expect(stable?.score).toBeGreaterThan(uncertain?.score ?? 0);
    });

    it('discounts an early luxury TE after the starting TE slot is filled', () => {
      const players = [
        {
          ...createPlayer('luxury-te', 'TE', 25),
          projectedPoints: 290,
          valueOverReplacement: 121,
        },
        {
          ...createPlayer('starter-rb', 'RB', 36),
          projectedPoints: 287,
          valueOverReplacement: 94,
        },
      ];
      const needs = createNeeds([
        { position: 'TE', priority: 'low', scarcityScore: 2 },
        { position: 'RB', priority: 'critical', scarcityScore: 5 },
      ]);

      const recommendations = getRecommendations(players, needs, 10, {
        currentPick: 27,
        totalPicks: 150,
      });
      const luxuryTe = recommendations.draftNow.find((rec) => rec.playerId === 'luxury-te');

      expect(recommendations.draftNow[0]?.playerId).toBe('starter-rb');
      expect(luxuryTe?.reason).toContain('depth fit');
      expect(luxuryTe?.subScores?.replacementScore).toBeLessThan(121 * 3.75);
      expect(recommendations.bestAvailable[0]?.playerId).toBe('luxury-te');
      expect(recommendations.bestAvailable[0]?.subScores).toBeUndefined();
    });
  });

  describe('bestAvailable', () => {
    it('returns players sorted by ECR rank', () => {
      const players = [
        createPlayer('p3', 'WR', 30),
        createPlayer('p1', 'QB', 10),
        createPlayer('p2', 'RB', 20),
      ];
      const needs = createNeeds([
        { position: 'QB', priority: 'low' },
        { position: 'RB', priority: 'low' },
        { position: 'WR', priority: 'low' },
      ]);

      const { bestAvailable } = getRecommendations(players, needs, 10);

      expect(bestAvailable[0]?.playerName).toBe('Player p1');
      expect(bestAvailable[0]?.reason).toContain('Trusted ECR Anchor #10');
      expect(bestAvailable[1]?.playerName).toBe('Player p2');
      expect(bestAvailable[2]?.playerName).toBe('Player p3');
    });

    it('respects the limit parameter', () => {
      const players = Array.from({ length: 20 }, (_, i) =>
        createPlayer(`p${String(i + 1)}`, 'WR', i + 1)
      );
      const needs = createNeeds([{ position: 'WR', priority: 'low' }]);

      const { bestAvailable } = getRecommendations(players, needs, 5);

      expect(bestAvailable).toHaveLength(5);
    });

    it('uses an ECR-only score for Best Player', () => {
      const players = [createPlayer('p1', 'QB', 15)];
      const needs = createNeeds([{ position: 'QB', priority: 'low' }]);

      const { bestAvailable } = getRecommendations(players, needs);

      expect(bestAvailable[0]?.score).toBe(-15);
      expect(bestAvailable[0]?.subScores).toBeUndefined();
      expect(bestAvailable[0]?.diagnostics?.marketRank).toBe(15);
    });

    it('ignores roster, return probability, draft timing, and model fields when choosing Best Player', () => {
      const ecrLeader = {
        ...createPlayer('ecr-leader', 'TE', 4),
        projectedPoints: 1,
        valueOverReplacement: -100,
        nextPickSurvivalProbability: 1,
        predictionSource: 'model' as const,
        injuryRiskScore: 100,
      };
      const policyFavorite = {
        ...createPlayer('policy-favorite', 'WR', 5),
        projectedPoints: 999,
        valueOverReplacement: 500,
        nextPickSurvivalProbability: 0,
        predictionSource: 'heuristic' as const,
        injuryRiskScore: 0,
      };
      const needs = createNeeds([
        { position: 'TE', priority: 'filled' },
        { position: 'WR', priority: 'critical' },
      ]);

      const result = getRecommendations(
        [policyFavorite, ecrLeader],
        needs,
        10,
        {
          architecture: 'pick-ev',
          currentPick: 100,
          totalPicks: 150,
          isMyTurn: true,
          requirements: DEFAULT_ROSTER_REQUIREMENTS,
          rosterCounts: { TE: DEFAULT_ROSTER_REQUIREMENTS.TE.max, WR: 0 },
        }
      );

      expect(result.bestAvailable.map((player) => player.playerId)).toEqual([
        'ecr-leader',
        'policy-favorite',
      ]);
      expect(result.bestAvailable[0]?.reason).toBe(
        'Trusted ECR Anchor #4 among available players'
      );
    });
  });

  describe('marketValues', () => {
    it('sorts actionable players by Sleeper market discount relative to ECR', () => {
      const players = [
        {
          ...createPlayer('small-value', 'WR', 20),
          marketRank: 25,
          marketAdp: 25,
          valueScore: 5,
        },
        {
          ...createPlayer('steal', 'RB', 30),
          marketRank: 48,
          marketAdp: 48,
          valueScore: 18,
        },
        {
          ...createPlayer('reach', 'QB', 12),
          marketRank: 8,
          marketAdp: 8,
          valueScore: -4,
        },
      ];
      const needs = createNeeds([
        { position: 'QB', priority: 'critical' },
        { position: 'RB', priority: 'low' },
        { position: 'WR', priority: 'low' },
      ]);

      const { marketValues } = getRecommendations(players, needs, 10);

      expect(marketValues.map((recommendation) => recommendation.playerId)).toEqual([
        'steal',
        'small-value',
      ]);
      expect(marketValues[0]?.reason).toContain('Steal +18');
    });

    it('hides replacement-level discounts from Best Value and labels them as late-round stashes', () => {
      const players = [
        {
          ...createPlayer('actionable-rb', 'RB', 42),
          marketRank: 60,
          marketAdp: 60,
          valueScore: 18,
          valueOverReplacement: 8,
        },
        {
          ...createPlayer('deep-qb', 'QB', 190),
          marketRank: 339,
          marketAdp: 339,
          valueScore: 149,
          valueOverReplacement: 0,
        },
      ];
      const needs = createNeeds([
        { position: 'QB', priority: 'low' },
        { position: 'RB', priority: 'low' },
      ]);

      const { marketValues, marketStashes } = getRecommendations(players, needs, 10);

      expect(marketValues.map((recommendation) => recommendation.playerId)).toEqual([
        'actionable-rb',
      ]);
      expect(marketStashes.map((recommendation) => recommendation.playerId)).toEqual([
        'deep-qb',
      ]);
      expect(marketStashes[0]?.reason).toContain('Late-round stash');
    });

    it('requires a meaningful market discount', () => {
      const players = [
        {
          ...createPlayer('small-discount', 'WR', 30),
          marketRank: 34,
          marketAdp: 34,
          valueScore: 4,
          valueOverReplacement: 12,
        },
      ];
      const needs = createNeeds([{ position: 'WR', priority: 'low' }]);

      const { marketValues, marketStashes } = getRecommendations(players, needs, 10);

      expect(marketValues).toHaveLength(0);
      expect(marketStashes).toHaveLength(0);
    });
  });

  describe('rbIntentionalReaches', () => {
    it('shows the best RB with custom VOR, tier supply, survival, and market reach cost', () => {
      const players = [
        {
          ...createPlayer('reach-rb', 'RB', 12, 'Reach RB'),
          marketRank: 28,
          marketAdp: 28,
          valueScore: 16,
          valueOverReplacement: 31.5,
          tier: 2,
          nextPickSurvivalProbability: 0.24,
        },
        {
          ...createPlayer('tier-mate', 'RB', 20, 'Tier Mate'),
          marketRank: 34,
          marketAdp: 34,
          valueScore: 14,
          valueOverReplacement: 18,
          tier: 2,
          nextPickSurvivalProbability: 0.4,
        },
        createPlayer('best-wr', 'WR', 5, 'Best WR'),
      ];
      const needs = createNeeds([
        { position: 'RB', priority: 'critical', scarcityScore: 9 },
        { position: 'WR', priority: 'critical' },
      ]);

      const { rbIntentionalReaches } = getRecommendations(players, needs, 5, {
        currentPick: 18,
        totalPicks: 150,
        totalTeams: 10,
      });

      expect(rbIntentionalReaches.map((recommendation) => recommendation.playerId)).toEqual([
        'reach-rb',
        'tier-mate',
      ]);
      expect(rbIntentionalReaches[0]?.diagnostics).toMatchObject({
        valueOverReplacement: 31.5,
        tier: 2,
        tierRemaining: 2,
        nextPickSurvivalProbability: 0.24,
        marketReachCost: 10,
      });
      expect(rbIntentionalReaches[0]?.reason).toContain(
        'Over market price, but correct for roster/scarcity'
      );
      expect(rbIntentionalReaches[0]?.reason).toContain('custom VOR 31.5');
      expect(rbIntentionalReaches[0]?.reason).toContain('24% to next pick');
      expect(rbIntentionalReaches[0]?.reason).toContain('market reach cost 10.0 picks');
    });

    it('uses the league-adjusted market price when one is available', () => {
      const rb = {
        ...createPlayer('league-rb', 'RB', 12),
        marketRank: 30,
        marketAdp: 30,
        leagueAdjustedMarketRank: 24,
      };
      const needs = createNeeds([{ position: 'RB', priority: 'critical' }]);

      const { rbIntentionalReaches } = getRecommendations([rb], needs, 5, {
        currentPick: 20,
        totalPicks: 150,
        totalTeams: 10,
      });

      expect(rbIntentionalReaches[0]?.diagnostics?.marketReachCost).toBe(4);
    });
  });

  describe('byNeed', () => {
    it('filters to critical and high priority positions', () => {
      const players = [
        createPlayer('p1', 'QB', 10),
        createPlayer('p2', 'RB', 15),
        createPlayer('p3', 'WR', 5),
      ];
      const needs = createNeeds([
        { position: 'QB', priority: 'critical' },
        { position: 'RB', priority: 'low' },
        { position: 'WR', priority: 'filled' },
      ]);

      const { byNeed } = getRecommendations(players, needs);

      expect(byNeed).toHaveLength(1);
      expect(byNeed[0]?.position).toBe('QB');
    });

    it('falls back to medium priority when no critical/high needs', () => {
      const players = [
        createPlayer('p1', 'QB', 10),
        createPlayer('p2', 'RB', 15),
      ];
      const needs = createNeeds([
        { position: 'QB', priority: 'medium' },
        { position: 'RB', priority: 'low' },
      ]);

      const { byNeed } = getRecommendations(players, needs);

      expect(byNeed).toHaveLength(1);
      expect(byNeed[0]?.position).toBe('QB');
    });

    it('applies need multiplier (2x for critical, 1.5x for high)', () => {
      const players = [
        createPlayer('p1', 'QB', 20),
        createPlayer('p2', 'RB', 20),
      ];
      const needs = createNeeds([
        { position: 'QB', priority: 'critical', scarcityScore: 5 },
        { position: 'RB', priority: 'high', scarcityScore: 5 },
      ]);

      const { byNeed } = getRecommendations(players, needs);

      const qbRec = byNeed.find((r) => r.position === 'QB');
      const rbRec = byNeed.find((r) => r.position === 'RB');

      expect(qbRec).toBeDefined();
      expect(rbRec).toBeDefined();
      // Same ECR rank (20), so base score is 80
      // QB: 80 * 2 (critical) * 1.25 (scarcity 5 -> 1 + 5/20)
      // RB: 80 * 1.5 (high) * 1.25 (scarcity)
      expect(qbRec?.score).toBeGreaterThan(rbRec?.score ?? 0);
    });

    it('applies scarcity multiplier', () => {
      const players = [
        createPlayer('p1', 'QB', 20),
        createPlayer('p2', 'TE', 20),
      ];
      const needs = createNeeds([
        { position: 'QB', priority: 'critical', scarcityScore: 2 },
        { position: 'TE', priority: 'critical', scarcityScore: 9 },
      ]);

      const { byNeed } = getRecommendations(players, needs);

      const qbRec = byNeed.find((r) => r.position === 'QB');
      const teRec = byNeed.find((r) => r.position === 'TE');

      expect(qbRec).toBeDefined();
      expect(teRec).toBeDefined();
      // TE should rank higher due to higher scarcity
      expect(teRec?.score).toBeGreaterThan(qbRec?.score ?? 0);
    });

    it('applies TE premium boost (1.15x)', () => {
      const players = [
        createPlayer('p1', 'WR', 20),
        createPlayer('p2', 'TE', 20),
      ];
      const needs = createNeeds([
        { position: 'WR', priority: 'critical', scarcityScore: 5 },
        { position: 'TE', priority: 'critical', scarcityScore: 5 },
      ]);

      const { byNeed } = getRecommendations(players, needs);

      const wrRec = byNeed.find((r) => r.position === 'WR');
      const teRec = byNeed.find((r) => r.position === 'TE');

      expect(wrRec).toBeDefined();
      expect(teRec).toBeDefined();
      // TE should rank higher due to TE premium
      expect(teRec?.score).toBeGreaterThan(wrRec?.score ?? 0);
    });

    it('includes reason with priority and scarcity', () => {
      const players = [createPlayer('p1', 'RB', 10)];
      const needs = createNeeds([
        { position: 'RB', priority: 'critical', scarcityScore: 7.5 },
      ]);

      const { byNeed } = getRecommendations(players, needs);

      expect(byNeed[0]?.reason).toContain('critical need');
      expect(byNeed[0]?.reason).toContain('FP #10');
    });

    it('sorts by calculated score descending', () => {
      const players = [
        createPlayer('p1', 'QB', 50), // Lower base score
        createPlayer('p2', 'RB', 10), // Higher base score
      ];
      const needs = createNeeds([
        { position: 'QB', priority: 'critical', scarcityScore: 5 },
        { position: 'RB', priority: 'critical', scarcityScore: 5 },
      ]);

      const { byNeed } = getRecommendations(players, needs);

      expect(byNeed[0]?.position).toBe('RB'); // Higher score first
    });
  });

  describe('edge cases', () => {
    it('handles empty players array', () => {
      const needs = createNeeds([{ position: 'QB', priority: 'critical' }]);

      const {
        draftNow,
        rbIntentionalReaches,
        bestAvailable,
        marketValues,
        marketStashes,
        byNeed,
      } = getRecommendations([], needs);

      expect(draftNow).toHaveLength(0);
      expect(rbIntentionalReaches).toHaveLength(0);
      expect(bestAvailable).toHaveLength(0);
      expect(marketValues).toHaveLength(0);
      expect(marketStashes).toHaveLength(0);
      expect(byNeed).toHaveLength(0);
    });

    it('handles empty needs array', () => {
      const players = [createPlayer('p1', 'QB', 10)];

      const { bestAvailable, byNeed } = getRecommendations(players, []);

      expect(bestAvailable).toHaveLength(1);
      expect(byNeed).toHaveLength(0);
    });
  });

  it('exposes named sub-scores on need-based recommendations', () => {
    const players = [createPlayer('p1', 'TE', 20)];
    const needs = createNeeds([{ position: 'TE', priority: 'critical', scarcityScore: 9 }]);

    const { byNeed } = getRecommendations(players, needs);

    expect(byNeed[0]?.subScores?.needMultiplier).toBe(2);
    expect(byNeed[0]?.subScores?.scarcityMultiplier).toBe(1.45);
    expect(byNeed[0]?.subScores?.tePremiumBoost).toBe(1.15);
  });
});

describe('getTopRecommendation', () => {
  it('returns the top combined draft-now recommendation when available', () => {
    const players = [
      createPlayer('p1', 'QB', 10, 'Patrick Mahomes'),
      createPlayer('p2', 'RB', 5, 'Christian McCaffrey'),
    ];
    const needs = createNeeds([
      { position: 'QB', priority: 'critical' },
      { position: 'RB', priority: 'low' },
    ]);

    const result = getTopRecommendation(players, needs);

    expect(result?.playerName).toBe('Patrick Mahomes');
    expect(result?.position).toBe('QB');
    expect(result?.reason).toContain('critical roster need');
  });

  it('falls back to bestAvailable when no need-based recommendations', () => {
    const players = [createPlayer('p1', 'QB', 10, 'Patrick Mahomes')];
    const needs = createNeeds([{ position: 'RB', priority: 'critical' }]);

    const result = getTopRecommendation(players, needs);

    expect(result?.playerName).toBe('Patrick Mahomes');
  });

  it('returns null when no players available', () => {
    const needs = createNeeds([{ position: 'QB', priority: 'critical' }]);

    const result = getTopRecommendation([], needs);

    expect(result).toBeNull();
  });
});
