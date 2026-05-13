import { describe, expect, it } from 'vitest';
import { fantasyProsApiInternals } from './fantasypros-api.js';

describe('fantasyProsApiInternals', () => {
  it('normalizes team and position identifiers', () => {
    expect(fantasyProsApiInternals.normalizeFantasyProsTeam('JAC')).toBe('JAX');
    expect(fantasyProsApiInternals.normalizeFantasyProsPosition('DST')).toBe('DEF');
  });

  it('parses rankings into ECR players', () => {
    const rankings = fantasyProsApiInternals.buildRankings([
      {
        player_id: 123,
        player_name: 'Player One',
        player_team_id: 'BUF',
        player_position_id: 'WR',
        player_bye_week: '12',
        rank_ecr: '7',
        rank_min: '5',
        rank_max: '10',
        rank_ave: '7.2',
        pos_rank: 'WR3',
      },
    ]);

    expect(rankings).toEqual([
      {
        rank: 7,
        name: 'Player One',
        position: 'WR',
        team: 'BUF',
        byeWeek: 12,
        positionalRank: 3,
        bestRank: 5,
        worstRank: 10,
        avgRank: 7.2,
      },
    ]);
  });

  it('builds projections using the requested scoring output', () => {
    const projections = fantasyProsApiInternals.buildProjections(
      [{
        fpid: 456,
        name: 'Player Two',
        position_id: 'RB',
        team_id: 'DET',
        stats: {
          points: 180,
          points_ppr: 220.5,
          points_half: 200.25,
        },
      }],
      'PPR'
    );

    expect(projections[0]?.projectedPoints).toBe(220.5);
  });

  it('derives news status and maps player ids through the player index', () => {
    const news = fantasyProsApiInternals.buildNews(
      {
        items: [
          {
            player_id: 789,
            title: 'Player Three ruled inactive for Sunday',
            category: 'injury',
            updated: '2026-05-12T12:00:00Z',
          },
        ],
      },
      new Map([
        ['789', { name: 'Player Three', team: 'KC', position: 'WR' }],
      ])
    );

    expect(news).toEqual([
      {
        name: 'Player Three',
        position: 'WR',
        team: 'KC',
        status: 'out',
        headline: 'Player Three ruled inactive for Sunday',
        updatedAt: '2026-05-12T12:00:00Z',
      },
    ]);
  });
});
