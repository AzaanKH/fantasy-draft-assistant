import { createSlotSequence } from '../draft-order.js';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ROSTER_REQUIREMENTS } from '../draft.js';
import { DEFAULT_SCORING_RULES } from '../league/scoring.js';
import { type Player, type Position } from '../player.js';
import { estimateMockSurvivalProbabilities, getKeeperAtPick, selectCpuPlayer, simulateCpuDraft, type MockDraftEngineConfig, type MockKeeperAssignment } from './mock-draft-engine.js';

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
  'RB', 'WR', 'RB', 'WR', 'TE', 'RB', 'WR', 'QB', 'RB', 'WR', 'K',
];

const players = Array.from({ length: 150 }, (_, index) =>
  player(
    `player-${String(index + 1)}`,
    positions[index % positions.length] ?? 'WR',
    index + 1,
    24 - (index % 20)
  )
);

const config: MockDraftEngineConfig = { draftType: 'snake',
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
  it('presents auction nominations and keeper reservations in legacy snake order', () => {
    expect([10, 11, 20, 21].map(pick => createSlotSequence({ type: 'auction', teams: 10, rounds: Math.ceil(pick / 10) }).at(pick).teamIndex))
      .toEqual([9, 9, 0, 0]);
    expect(getKeeperAtPick([javonte], 96, 10, 'auction')).toEqual(javonte);
    expect(getKeeperAtPick([javonte], 95, 10, 'auction')).toBeUndefined();
  });

  it('keeps the exact custom scoring and two-FLEX league rules', () => {
    expect(DEFAULT_SCORING_RULES.rushing.attemptBonus).toBe(0.2);
    expect(DEFAULT_SCORING_RULES.receiving.tePremium).toBe(0.5);
    expect(DEFAULT_ROSTER_REQUIREMENTS.FLEX.starters).toBe(2);
  });

  it('maps team 5 round 10 to 10.06 and consumes Javonte there', () => {
    expect(createSlotSequence({ type: 'snake', teams: 10, rounds: 10 }).forTeamRound(4, 10).pick).toBe(96);
    expect(getKeeperAtPick([javonte], 96, 10, 'snake')).toEqual(javonte);
    expect(getKeeperAtPick([javonte], 95, 10, 'snake')).toBeUndefined();
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
      freshSelectionLimit: 150,
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
    const kickerPicks = picks.filter((pick) => pick.position === 'K');
    expect(kickerPicks.length).toBeGreaterThan(0);
    expect(kickerPicks.every((pick) => Math.ceil(pick.pickNumber / config.totalTeams) >= 13)).toBe(true);
  });

  it('counts a keeper as drafted even when the caller omitted its ID', () => {
    const keeper = { ...javonte, playerId: 'player-1', teamIndex: 0, round: 1 };
    const input = {
      players,
      history: [],
      keepers: [keeper],
      currentPick: 1,
      config,
      iterations: 10,
    };
    const omitted = estimateMockSurvivalProbabilities({
      ...input,
      draftedPlayerIds: new Set<string>(),
    });
    const reserved = estimateMockSurvivalProbabilities({
      ...input,
      draftedPlayerIds: new Set([keeper.playerId]),
    });

    expect(omitted[keeper.playerId]).toBe(0);
    expect(Object.fromEntries(Object.entries(omitted).filter(
      ([id]) => id !== keeper.playerId
    ))).toEqual(reserved);
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

  describe('superflex leagues', () => {
    const superflex: MockDraftEngineConfig = {
      ...config,
      totalTeams: 2,
      totalRounds: 7,
      randomness: 0,
      rosterRequirements: {
        ...DEFAULT_ROSTER_REQUIREMENTS,
        QB: { starters: 1, max: 3 },
        FLEX: { starters: 1, eligiblePositions: ['QB', 'RB', 'WR', 'TE'] },
        K: { starters: 0, max: 1 },
        DEF: { starters: 0, max: 1 },
        BENCH: { spots: 0 },
      },
    };
    // Team 0 picks 1, 4, 5, 8, 9 and 12 in a two-team snake; pick 13 is its last.
    const filled: readonly Position[] = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE'];
    const history = [1, 4, 5, 8, 9, 12].map((pickNumber, index) => ({
      pickNumber,
      playerId: `team-0-${String(index)}`,
      position: filled[index] ?? 'WR',
      teamIndex: 0,
    }));

    it('lets a second QB fill the open superflex slot with the last pick', () => {
      const selection = selectCpuPlayer({
        players: [player('second-qb', 'QB', 20)],
        draftedPlayerIds: new Set(history.map((pick) => pick.playerId)),
        history,
        keepers: [],
        currentPick: 13,
        config: superflex,
      });

      expect(selection?.player.id).toBe('second-qb');
    });

    it('treats a second QB as a superflex need, not a redundant starter', () => {
      const selection = selectCpuPlayer({
        players: [player('second-qb', 'QB', 20), player('extra-k', 'K', 21)],
        draftedPlayerIds: new Set<string>(),
        history: history.slice(0, 5),
        keepers: [],
        currentPick: 12,
        config: { ...superflex, totalRounds: 8 },
      });
      const qb = selection?.shortlist.find((candidate) => candidate.player.id === 'second-qb');

      expect(qb?.components.rosterNeed).toBe(5);
    });
  });
});
