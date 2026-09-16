import { describe, expect, it } from 'vitest';
import type {
  Player,
  SportsbookMilestoneLine,
  SportsbookSnapshot,
} from '@fantasy-draft/shared';
import { buildMilestoneWatchlist } from './milestone-watchlist';

function createPlayer(id: string, name: string, marketRank: number): Player {
  return {
    id,
    name,
    position: 'WR',
    team: 'DET',
    byeWeek: 5,
    ecrRank: marketRank,
    positionalRank: marketRank,
    sleeperAdp: marketRank,
    valueScore: 0,
    marketRank,
    marketAdp: marketRank,
    marketAdpTrend: 0,
    isContractYear: false,
    offensiveEnvironmentScore: 5,
    projectedPoints: 200,
    valueOverReplacement: 20,
    tier: 1,
    tierDropoffScore: 0,
    nextPickSurvivalProbability: 0.5,
    ceilingScore: 6,
    floorScore: 5,
    upsideScore: 6,
    uncertaintyScore: 3,
    injuryRiskScore: 2,
    predictionSource: 'fantasypros',
    newsStatus: 'healthy',
    stackPartnerTeam: 'DET',
    highlightLevel: 'neutral',
  };
}

function createLine(
  playerName: string,
  americanOdds: number,
  overrides: Partial<SportsbookMilestoneLine> = {}
): SportsbookMilestoneLine {
  return {
    sportsbook: 'draftkings',
    playerName,
    market: 'receivingYards',
    threshold: 1_000,
    americanOdds,
    sourceFile: 'milestones.pdf',
    ...overrides,
  };
}

function createSnapshot(
  milestones: readonly SportsbookMilestoneLine[]
): SportsbookSnapshot {
  return {
    metadata: {
      season: 2026,
      capturedAt: '2026-07-30T14:39:00-07:00',
      importedAt: '2026-07-30T22:15:17.728Z',
      sourceDirectory: 'betting-lines-pdfs',
      overUnderCount: 0,
      milestoneCount: milestones.length,
    },
    overUnder: [],
    milestones,
    warnings: [],
  };
}

describe('buildMilestoneWatchlist', () => {
  it('derives the list from every matching market line and sorts by probability', () => {
    const players = [
      createPlayer('a', 'Alpha Receiver', 30),
      createPlayer('b', 'Bravo Receiver Jr.', 50),
      createPlayer('c', 'Charlie Receiver', 70),
    ];
    const snapshot = createSnapshot([
      createLine('Charlie Receiver', 300),
      createLine('Alpha Receiver', -150),
      createLine('Bravo Receiver', 100),
      createLine('Ignored Threshold', 100, { threshold: 900 }),
      createLine('Ignored Book', 100, { sportsbook: 'fanduel' }),
    ]);

    const rows = buildMilestoneWatchlist(players, snapshot, new Set());

    expect(rows.map((row) => row.player.id)).toEqual(['a', 'b', 'c']);
    expect(rows.map((row) => Number(row.probability.toFixed(2)))).toEqual([
      0.6,
      0.5,
      0.25,
    ]);
  });

  it('removes drafted players so the watchlist advances during the draft', () => {
    const players = [
      createPlayer('a', 'Alpha Receiver', 10),
      createPlayer('b', 'Bravo Receiver', 20),
    ];
    const snapshot = createSnapshot([
      createLine('Alpha Receiver', -200),
      createLine('Bravo Receiver', 100),
    ]);

    const rows = buildMilestoneWatchlist(players, snapshot, new Set(['a']));

    expect(rows.map((row) => row.player.id)).toEqual(['b']);
  });
});

