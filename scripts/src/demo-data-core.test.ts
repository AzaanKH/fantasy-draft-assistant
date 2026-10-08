import type { Position } from '@fantasy-draft/shared';
import { describe, expect, it } from 'vitest';
import {
  anonymizeSurvivalModel,
  blendDemoRankings,
  buildDemoSnapshot,
  findDemoDataLeaks,
  LATE_ROUND_START,
  modelWeight,
  type DemoPredictionPlayer,
  type DemoSleeperPlayer,
} from './demo-data-core.js';

function prediction(
  playerId: string,
  position: Position,
  projectedPoints: number,
  valueOverReplacement: number,
  uncertaintyScore = 2
): DemoPredictionPlayer {
  return {
    playerId,
    name: `Player ${playerId}`,
    position,
    team: 'DET',
    projectedPoints,
    floorProjectedPoints: projectedPoints - 20,
    ceilingProjectedPoints: projectedPoints + 40,
    valueOverReplacement,
    uncertaintyScore,
  };
}

function sleeper(playerId: string, position: Position, sleeperAdp: number): DemoSleeperPlayer {
  return { playerId, name: `Player ${playerId}`, position, team: 'DET', sleeperAdp };
}

describe('demo rankings', () => {
  it('trusts the model less as its uncertainty rises', () => {
    expect(modelWeight(1)).toBe(0.6);
    expect(modelWeight(10)).toBeCloseTo(0.15);
    expect(modelWeight(5)).toBeCloseTo(0.4);
  });

  it('compares positions by model value, not by Sleeper popularity', () => {
    const ranked = blendDemoRankings(
      [
        prediction('qb', 'QB', 380, 40),
        prediction('rb', 'RB', 300, 120),
        prediction('wr', 'WR', 280, 90),
      ],
      [sleeper('qb', 'QB', 1), sleeper('rb', 'RB', 2), sleeper('wr', 'WR', 3)]
    );

    expect(ranked.map((player) => player.sleeperId)).toEqual(['rb', 'wr', 'qb']);
  });

  it('lets a confident projection reorder players within a position', () => {
    const ranked = blendDemoRankings(
      [prediction('a', 'WR', 200, 20), prediction('b', 'WR', 300, 100), prediction('c', 'WR', 250, 60)],
      [sleeper('a', 'WR', 1), sleeper('b', 'WR', 3), sleeper('c', 'WR', 2)]
    );

    expect(ranked.map((player) => player.sleeperId)).toEqual(['b', 'c', 'a']);
    // The market keeps Sleeper's order in the same WR slots.
    expect(ranked.map((player) => [player.sleeperId, player.adpRank])).toEqual([
      ['b', 3],
      ['c', 2],
      ['a', 1],
    ]);
  });

  it('places kickers late, keeps unprojected players, and drops unranked ones', () => {
    const skill = Array.from({ length: LATE_ROUND_START + 5 }, (_, index) =>
      prediction(`wr${String(index)}`, 'WR', 300 - index, 200 - index));
    const ranked = blendDemoRankings(
      [...skill, prediction('k', 'K', 150, 47)],
      [
        sleeper('k', 'K', 1),
        sleeper('rookie', 'RB', 2),
        sleeper('unranked', 'WR', 999),
        ...skill.map((player, index) => sleeper(player.playerId, 'WR', index + 3)),
      ]
    );

    expect(ranked.find((player) => player.sleeperId === 'k')?.rank).toBe(LATE_ROUND_START);
    expect(ranked.find((player) => player.sleeperId === 'rookie')?.prediction).toBeNull();
    expect(ranked.some((player) => player.sleeperId === 'unranked')).toBe(false);
  });

  it('keeps every defense, ordered by the model, after the ranking count', () => {
    const ranked = blendDemoRankings(
      [prediction('wr', 'WR', 300, 100), prediction('weak', 'DEF', 90, 0), prediction('strong', 'DEF', 140, 0)],
      [sleeper('wr', 'WR', 1), sleeper('weak', 'DEF', 999), sleeper('strong', 'DEF', 999)],
      1
    );

    expect(ranked.map((player) => player.sleeperId)).toEqual(['wr', 'strong', 'weak']);
  });

  it('builds a snapshot with demo IDs, positional ranks, bye weeks, and no news', () => {
    const ranked = blendDemoRankings(
      [prediction('a', 'WR', 300, 100), prediction('b', 'WR', 250, 50)],
      [sleeper('a', 'WR', 1), sleeper('b', 'WR', 2)]
    );
    const snapshot = buildDemoSnapshot(ranked, { DET: 8 }, 2026, '2026-09-05T00:00:00.000Z');

    expect(snapshot.metadata).toMatchObject({ season: 2026, sourceType: 'fixture', newsCount: 0 });
    expect(snapshot.rankings[1]).toMatchObject({
      fantasyProsId: 'demo-b',
      rank: 2,
      positionalRank: 2,
      byeWeek: 8,
    });
    expect(snapshot.projections[0]).toMatchObject({ fantasyProsId: 'demo-a', projectedPoints: 300 });
    expect(snapshot.news).toEqual([]);
  });
});

describe('demo survival model', () => {
  it('keeps aggregate draft behavior but replaces the league name and member IDs', () => {
    const model = anonymizeSurvivalModel({
      leagueName: 'Private League',
      sampleSize: 550,
      sourceResponsibilities: { leagueHistory: 'history' },
      managerTendencies: [{ managerKey: 'user_d8ecf12b7f31', sampleSize: 57 }],
    });

    expect(model).toMatchObject({
      leagueName: 'Demo League',
      sampleSize: 550,
      sourceResponsibilities: { leagueHistory: 'history' },
      managerTendencies: [{ managerKey: 'demo-manager-1', sampleSize: 57 }],
    });
  });
});

describe('demo leak check', () => {
  it('accepts demo IDs', () => {
    expect(findDemoDataLeaks('ok.json', '{"fantasyProsId": "demo-9221"}')).toEqual([]);
  });

  it('reports FantasyPros IDs, URLs, Sleeper user and league IDs, and the league name', () => {
    const content = JSON.stringify({
      fantasyProsId: '22968',
      link: 'https://www.fantasypros.com/nfl/news/1.php',
      managerKey: 'user_d8ecf12b7f31',
      leagueId: '1117608116687826944',
      leagueName: 'Ummati Official',
    });

    expect(findDemoDataLeaks('leak.json', content)).toEqual([
      'leak.json contains the real league name',
      'leak.json contains a FantasyPros URL',
      'leak.json contains a Sleeper user ID',
      'leak.json contains a Sleeper league or draft ID',
      'leak.json contains a FantasyPros player ID (22968)',
    ]);
  });
});
