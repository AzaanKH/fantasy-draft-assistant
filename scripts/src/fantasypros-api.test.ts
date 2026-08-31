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
        fantasyProsId: '123',
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

  it('parses consensus ADP separately from expert rankings', () => {
    expect(fantasyProsApiInternals.buildAdp([{
      player_id: 321,
      player_name: 'Market Player',
      player_team_id: 'KC',
      player_position_id: 'TE',
      rank_ecr: 18,
      rank_min: 14,
      rank_max: 24,
      rank_ave: 18.5,
      pos_rank: 'TE2',
    }])).toEqual([{
      fantasyProsId: '321',
      rank: 18,
      name: 'Market Player',
      position: 'TE',
      team: 'KC',
      positionalRank: 2,
      bestRank: 14,
      worstRank: 24,
      averageRank: 18.5,
    }]);
  });

  it('skips rankings with missing or invalid consensus rank values', () => {
    const rankings = fantasyProsApiInternals.buildRankings([
      {
        player_id: 123,
        player_name: 'Missing Rank',
        player_team_id: 'BUF',
        player_position_id: 'WR',
      },
      {
        player_id: 124,
        player_name: 'Bad Rank',
        player_team_id: 'BUF',
        player_position_id: 'WR',
        rank_ecr: 'not-a-number',
      },
    ]);

    expect(rankings).toEqual([]);
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
          rush_att: 240,
          rush_yds: 1_075,
          rush_tds: 9,
          rec: 45,
          rec_yds: 390,
          rec_tds: 3,
        },
      }],
      'PPR'
    );

    expect(projections[0]?.projectedPoints).toBe(220.5);
    expect(projections[0]?.baseProjectedPoints).toBe(220.5);
    expect(projections[0]?.customScoringAdjustment).toBeUndefined();
    expect(projections[0]?.leagueProjectedPoints).toBeUndefined();
    expect(projections[0]?.projectedRushingYards).toBe(1_075);
    expect(projections[0]?.projectedRushingTouchdowns).toBe(9);
    expect(projections[0]?.projectedReceivingYards).toBe(390);
    expect(projections[0]?.projectedReceivingTouchdowns).toBe(3);
  });

  it('keeps tight-end receptions as a raw component for local scoring', () => {
    const [tightEnd] = fantasyProsApiInternals.buildProjections([{
      fpid: 999,
      name: 'Premium Tight End',
      position_id: 'TE',
      team_id: 'DET',
      stats: { points_ppr: 180, rush_att: 2, rec: 80 },
    }], 'PPR');

    expect(tightEnd?.projectedRushAttempts).toBe(2);
    expect(tightEnd?.projectedReceptions).toBe(80);
    expect(tightEnd?.projectedPoints).toBe(180);
  });

  it('reads receptions from the FantasyPros rec_rec API field', () => {
    const [tightEnd] = fantasyProsApiInternals.buildProjections([{
      fpid: 1000,
      name: 'API Tight End',
      position_id: 'TE',
      team_id: 'KC',
      stats: { points_ppr: 200, rec_rec: 90 },
    }], 'PPR');

    expect(tightEnd?.projectedReceptions).toBe(90);
    expect(tightEnd?.customScoringAdjustment).toBeUndefined();
    expect(tightEnd?.leagueProjectedPoints).toBeUndefined();
  });

  it('derives news status and maps player ids through the player index', () => {
    const news = fantasyProsApiInternals.buildNews(
      {
        items: [
          {
            player_id: 789,
            title: 'Player Three ruled inactive for Sunday',
            team_id: 'KC',
            categories: ['Injury', 'News'],
            created: '2026-05-12 12:00:00',
            desc: 'Player Three will not play Sunday.',
            impact: 'Use another receiver.',
            link: 'https://www.fantasypros.com/nfl/news/789/player-three.php',
          },
        ],
      },
      new Map([
        ['789', { name: 'Player Three', team: 'KC', position: 'WR' }],
      ])
    );

    expect(news).toEqual([
      {
        fantasyProsId: '789',
        name: 'Player Three',
        position: 'WR',
        team: 'KC',
        status: 'out',
        headline: 'Player Three ruled inactive for Sunday',
        categories: ['Injury', 'News'],
        description: 'Player Three will not play Sunday.',
        impact: 'Use another receiver.',
        link: 'https://www.fantasypros.com/nfl/news/789/player-three.php',
        updatedAt: '2026-05-12T12:00:00Z',
      },
    ]);
  });

  it('leaves a missing news publication time missing', () => {
    const [news] = fantasyProsApiInternals.buildNews(
      { items: [{ player_id: 789, title: 'Player Three injury update' }] },
      new Map([['789', { name: 'Player Three', team: 'KC', position: 'WR' }]])
    );

    expect(news).not.toHaveProperty('updatedAt');
  });

  it('combines structured injuries with injury news', () => {
    const playerIndex = new Map([
      ['789', { name: 'Player Three', team: 'KC' as const, position: 'WR' as const }],
      ['790', { name: 'Player Four', team: 'BUF' as const, position: 'RB' as const }],
    ]);
    const news = fantasyProsApiInternals.buildNews(
      {
        items: [{
          player_id: 789,
          title: 'Player Three uncertain for Week 1',
          created: '2026-08-29 15:30:00',
        }],
      },
      playerIndex
    );
    const injuries = fantasyProsApiInternals.buildInjuryNews(
      {
        injuries: [
          {
            player_id: 789,
            name: 'Player Three',
            team_id: 'KC',
            position_id: 'WR',
            status: 'PUP',
            injury_type: 'Knee',
            injury_update_date: '2026-08-28 12:00:00',
          },
          {
            player_id: 790,
            name: 'Player Four',
            team_id: 'BUF',
            position_id: 'RB',
            status: 'OUT',
            comment: 'Player Four will miss Week 1.',
            injury_update_date: '2026-08-29 12:00:00',
          },
        ],
      },
      playerIndex
    );

    expect(fantasyProsApiInternals.combineNewsWithInjuries(news, injuries)).toEqual([
      {
        fantasyProsId: '789',
        name: 'Player Three',
        position: 'WR',
        team: 'KC',
        status: 'out',
        headline: 'Player Three uncertain for Week 1',
        updatedAt: '2026-08-29T15:30:00Z',
      },
      {
        fantasyProsId: '790',
        name: 'Player Four',
        position: 'RB',
        team: 'BUF',
        status: 'out',
        headline: 'Player Four will miss Week 1.',
        categories: ['injury'],
        description: 'Player Four will miss Week 1.',
        updatedAt: '2026-08-29T12:00:00Z',
      },
    ]);
  });

  it('does not infer out status from unrelated substrings or standout phrasing', () => {
    expect(fantasyProsApiInternals.deriveStructuredStatus({ status: 'OUT' })).toBe('out');
    expect(fantasyProsApiInternals.deriveStructuredStatus({ status: 'IR' })).toBe('out');
    expect(fantasyProsApiInternals.deriveStructuredStatus({ status: 'PUP' })).toBe('out');
    expect(fantasyProsApiInternals.deriveStructuredStatus({ status_short: 'O' })).toBe('out');
    expect(fantasyProsApiInternals.deriveNewsStatus({
      title: 'Rookie stood out without limitations at practice',
    })).toBe('unknown');
    expect(fantasyProsApiInternals.deriveNewsStatus({
      title: 'Veteran ruled out for Sunday',
    })).toBe('out');
    expect(fantasyProsApiInternals.deriveNewsStatus({
      title: 'Christian McCaffrey sitting out Tuesday practice',
      category: 'injury',
    })).toBe('limited');
    expect(fantasyProsApiInternals.deriveNewsStatus({
      title: 'Christian McCaffrey not practicing Tuesday',
    })).toBe('limited');
    expect(fantasyProsApiInternals.deriveNewsStatus({
      title: 'Zay Flowers misses practice Wednesday',
    })).toBe('limited');
    expect(fantasyProsApiInternals.deriveNewsStatus({
      title: 'Christian McCaffrey uncertain for Week 1',
    })).toBe('questionable');
    expect(fantasyProsApiInternals.deriveNewsStatus({
      title: 'Christian McCaffrey uncertain for Week 1',
      status: 'IR',
    })).toBe('out');
  });

  it('omits null FantasyPros identifiers instead of serializing them', () => {
    const rankings = fantasyProsApiInternals.buildRankings([{
      player_id: null,
      player_name: 'Player Without Id',
      player_team_id: 'BUF',
      player_position_id: 'WR',
      rank_ecr: 50,
    }]);

    expect(rankings[0]?.fantasyProsId).toBeUndefined();
  });
});
