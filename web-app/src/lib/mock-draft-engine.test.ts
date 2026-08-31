import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROSTER_REQUIREMENTS,
  DEFAULT_SCORING_RULES,
  type Player,
  type Position,
} from '@fantasy-draft/shared';
import {
  estimateMockSurvivalProbabilities,
  getKeeperAtPick,
  getPickNumberForTeamRound,
  selectCpuPlayer,
  simulateCpuDraft,
  type MockDraftEngineConfig,
  type MockKeeperAssignment,
} from './mock-draft-engine';

function player(
  id: string,
  position: Position,
  marketRank: number,
  valueOverReplacement: number = 12
): Player {
  return {
    id,
    name: id,
    position,
    team: 'BUF',
    byeWeek: 7,
    ecrRank: marketRank,
    positionalRank: marketRank,
    sleeperAdp: marketRank,
    consensusAdp: marketRank,
    valueScore: 0,
    marketRank,
    marketAdp: marketRank,
    marketAdpTrend: 0,
    isContractYear: false,
    offensiveEnvironmentScore: 7,
    projectedPoints: 250 - marketRank,
    customProjectedPoints: 250 - marketRank,
    valueOverReplacement,
    tier: Math.ceil(marketRank / 12),
    tierDropoffScore: marketRank % 12 === 0 ? 0.8 : 0.1,
    tierDropoffPoints: marketRank % 12 === 0 ? 10 : 1,
    nextPickSurvivalProbability: 0.5,
    ceilingScore: 8,
    floorScore: 5,
    upsideScore: 7,
    uncertaintyScore: 3,
    injuryRiskScore: 2,
    predictionSource: 'model',
    newsStatus: 'healthy',
    stackPartnerTeam: 'BUF',
    highlightLevel: 'neutral',
  };
}

const positions: readonly Position[] = [
  'RB', 'WR', 'RB', 'WR', 'TE', 'RB', 'WR', 'QB', 'RB', 'WR',
];

const players = Array.from({ length: 150 }, (_, index) =>
  player(
    `player-${String(index + 1)}`,
    positions[index % positions.length] ?? 'WR',
    index + 1,
    24 - (index % 20)
  )
);

const config: MockDraftEngineConfig = {
  totalTeams: 10,
  totalRounds: 15,
  myPickPosition: 5,
  rosterRequirements: DEFAULT_ROSTER_REQUIREMENTS,
  randomness: 0.6,
  seed: 42,
};

const javonte: MockKeeperAssignment = {
  playerId: 'javonte',
  playerName: 'Javonte Williams',
  position: 'RB',
  teamIndex: 4,
  round: 10,
};

describe('mock draft engine', () => {
  it('keeps the exact custom scoring and two-FLEX league rules', () => {
    expect(DEFAULT_SCORING_RULES.rushing.attemptBonus).toBe(0.2);
    expect(DEFAULT_SCORING_RULES.receiving.tePremium).toBe(0.5);
    expect(DEFAULT_ROSTER_REQUIREMENTS.FLEX.starters).toBe(2);
  });

  it('maps team 5 round 10 to 10.06 and consumes Javonte there', () => {
    expect(getPickNumberForTeamRound(4, 10, 10)).toBe(96);
    expect(getKeeperAtPick([javonte], 96, 10)).toEqual(javonte);
    expect(getKeeperAtPick([javonte], 95, 10)).toBeUndefined();
  });

  it('is reproducible for a seed and samples only the plausible top 10-15', () => {
    const input = {
      players,
      draftedPlayerIds: new Set<string>(),
      history: [],
      keepers: [],
      currentPick: 1,
      config,
    } as const;
    const first = selectCpuPlayer(input);
    const second = selectCpuPlayer(input);

    expect(first?.player.id).toBe(second?.player.id);
    expect(first?.shortlist.length).toBeGreaterThanOrEqual(10);
    expect(first?.shortlist.length).toBeLessThanOrEqual(15);
    expect(first?.shortlist.map((row) => row.player.id)).toContain(first?.player.id);

    const outcomes = new Set(
      Array.from({ length: 20 }, (_, seed) => selectCpuPlayer({
        ...input,
        config: { ...config, seed },
      })?.player.id)
    );
    expect(outcomes.size).toBeGreaterThan(1);
  });

  it('respects roster construction and delays special teams', () => {
    const picks = simulateCpuDraft({
      players,
      keepers: [],
      config,
      freshSelectionLimit: 80,
    }).filter((pick) => pick.source === 'cpu');
    const perTeam = new Map<number, Record<Position, number>>();
    for (const pick of picks) {
      const counts = perTeam.get(pick.teamIndex) ?? {
        QB: 0,
        RB: 0,
        WR: 0,
        TE: 0,
        K: 0,
        DEF: 0,
      };
      counts[pick.position] += 1;
      perTeam.set(pick.teamIndex, counts);
    }

    expect([...perTeam.values()].every((counts) => counts.QB <= 2)).toBe(true);
    expect([...perTeam.values()].every((counts) => counts.TE <= 2)).toBe(true);
    expect(picks.some((pick) => pick.position === 'K' || pick.position === 'DEF')).toBe(false);
  });

  it('returns seeded Monte Carlo survival estimates for the next user pick', () => {
    const first = estimateMockSurvivalProbabilities({
      players,
      draftedPlayerIds: new Set<string>(),
      history: [],
      keepers: [],
      currentPick: 1,
      config,
      iterations: 100,
    });
    const second = estimateMockSurvivalProbabilities({
      players,
      draftedPlayerIds: new Set<string>(),
      history: [],
      keepers: [],
      currentPick: 1,
      config,
      iterations: 100,
    });

    expect(first).toEqual(second);
    expect(first['player-1']).toBeLessThan(1);
    expect(first['player-10']).toBeGreaterThan(0);
  });
});
