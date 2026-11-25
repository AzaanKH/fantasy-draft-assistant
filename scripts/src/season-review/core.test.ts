import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING_RULES, FLEX_GROUPS } from '@fantasy-draft/shared/league';
import {
  acquisitionSource,
  adpDelta,
  aggregateSeason,
  classifyRisks,
  classifyStrategy,
  expectedValueBySlot,
  leagueProjection,
  nextSnakePick,
  normalizeName,
  parseCsv,
  pickupStints,
  replacementLevels,
  scoreStats,
  spearman,
  sportsbookProjectionGap,
  starterSlotsFromRoster,
  type RiskInput,
} from './core.js';
import {
  lastScoredWeek,
  parseSeasonReviewArgs,
  predraftSnapshotProblem,
  resolveManagerSlot,
  resolveThroughWeek,
} from '../generate-season-review.js';

const scoring = { pass_yd: 0.04, pass_td: 4, rush_yd: 0.1, rush_td: 6, rush_att: 0.2, rec: 1, rec_yd: 0.1, rec_td: 6, bonus_rec_te: 0.5 };

describe('season review scoring', () => {
  it('scores raw stat lines with league weights and ignores unscored keys', () => {
    expect(scoreStats({ rec: 4, rec_yd: 31, bonus_rec_te: 4, rec_tgt: 9, off_snp: 57 }, scoring)).toBe(9.1);
    expect(scoreStats({ rush_att: 20, rush_yd: 100, rush_td: 1 }, scoring)).toBe(20);
  });

  it('counts games from gp and keeps scoreless active weeks', () => {
    const lines = aggregateSeason([
      { week: 2, stats: { a: { gp: 1, rec: 5 } } },
      { week: 1, stats: { a: { gp: 1, rec: 1 }, b: { gp: 0 } } },
      { week: 3, stats: { a: { gp: 1 } } },
    ], scoring);
    expect(lines.get('a')).toMatchObject({ points: 6, games: 3, pointsPerGame: 2, weeklyPoints: [1, 5, 0] });
    expect(lines.has('b')).toBe(false);
  });

  it('re-scores base PPR projections for league rules through the shared calculator', () => {
    const rules = { ...DEFAULT_SCORING_RULES, rushing: { ...DEFAULT_SCORING_RULES.rushing, attemptBonus: 0.2 } };
    expect(leagueProjection({ projectedPoints: 200, projectedReceptions: 80 }, 'TE', rules)).toBe(240);
    expect(leagueProjection({ projectedPoints: 200, projectedRushAttempts: 250, projectedReceptions: 40 }, 'RB', rules)).toBe(250);
    // Half PPR: an 80-catch receiver loses 40 of the full-PPR base, and the base wins over an adjusted total.
    const halfPpr = { ...rules, receiving: { ...rules.receiving, reception: 0.5 } };
    expect(leagueProjection({ projectedPoints: 999, baseProjectedPoints: 200, projectedReceptions: 80 }, 'WR', halfPpr)).toBe(160);
    expect(leagueProjection({ projectedPoints: 5 }, 'DST', rules)).toBeNull();
  });
});

describe('replacement and value over cost', () => {
  it('fills fixed starters first, then FLEX from the best remaining eligible players', () => {
    const slots = starterSlotsFromRoster('QB RB WR FLEX BN'.split(' '), FLEX_GROUPS.standard);
    const players = [
      { position: 'QB', points: 300 }, { position: 'QB', points: 250 }, { position: 'QB', points: 200 },
      { position: 'RB', points: 180 }, { position: 'RB', points: 170 }, { position: 'RB', points: 160 }, { position: 'RB', points: 90 },
      { position: 'WR', points: 175 }, { position: 'WR', points: 150 }, { position: 'WR', points: 100 },
    ];
    // Two teams: QB1×2, RB1×2, WR1×2, then FLEX×2 = RB 160 and WR 100.
    expect(Object.fromEntries(replacementLevels(players, slots, 2))).toEqual({ QB: 200, RB: 90, WR: 0 });
  });

  it('averages realized VOR within the window around each pick', () => {
    const expected = expectedValueBySlot([{ pickNo: 1, vor: 90 }, { pickNo: 2, vor: 30 }, { pickNo: 3, vor: 0 }, { pickNo: 10, vor: 6 }], 1);
    expect([...expected]).toEqual([[1, 60], [2, 40], [3, 15], [10, 6]]);
  });

  it('signs ADP deltas so later-than-ADP picks are values', () => {
    expect(adpDelta(96, 31)).toBe(65);
    expect(adpDelta(5, 8)).toBe(-3);
    expect(adpDelta(5, null)).toBeNull();
  });
});

describe('rank statistics', () => {
  it('computes Spearman rho with average ranks for ties', () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBe(1);
    expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBe(-1);
    expect(spearman([1, 2, 2, 4], [1, 3, 2, 4])).toBeCloseTo(0.949, 3);
    expect(spearman([1, 2], [1, 2])).toBeNull();
    expect(spearman([1, 1, 1], [1, 2, 3])).toBeNull();
  });
});

describe('draft structure', () => {
  it('finds the same slot in the next snake round', () => {
    expect(nextSnakePick(5, 10, 14)).toBe(16);
    expect(nextSnakePick(16, 10, 14)).toBe(25);
    expect(nextSnakePick(136, 10, 14)).toBeNull();
  });

  it('labels builds from early-round positions', () => {
    expect(classifyStrategy(['WR', 'RB', 'WR', 'WR', 'WR', 'QB'])).toEqual(['wr-heavy']);
    expect(classifyStrategy(['RB', 'TE', 'WR', 'QB', 'RB'])).toEqual(['balanced', 'early-qb', 'early-te']);
    expect(classifyStrategy(['WR', 'WR', 'TE', 'WR', 'QB'])).toEqual(['zero-rb', 'wr-heavy', 'early-te']);
    expect(classifyStrategy(['RB', 'WR', 'WR', 'WR', 'TE'])).toEqual(['hero-rb', 'wr-heavy']);
  });
});

describe('risk categories', () => {
  const base: RiskInput = {
    position: 'RB', yearsExp: 4, age: 25, priorSeasonGames: 17, priorTeam: 'DEN', draftTeam: 'DEN', teamQbChanged: false,
    contractYear: false, expertSpread: 0.5, expertSpreadThreshold: 1.2, sportsbookGap: 0.05, adpDelta: 0, isKeeper: false,
  };

  it('flags each supported risk from its own evidence', () => {
    expect(classifyRisks(base)).toEqual([]);
    expect(classifyRisks({
      ...base, age: 28, priorSeasonGames: 9, priorTeam: 'DAL', teamQbChanged: true, contractYear: true,
      expertSpread: 1.2, sportsbookGap: -0.2, adpDelta: -12,
    })).toEqual(['prior-missed-games', 'age-cliff', 'team-change', 'qb-change', 'contract-year', 'expert-disagreement', 'sportsbook-disagreement', 'reach-vs-adp']);
  });

  it('does not treat rookies as injured or traded, or keepers as reaches', () => {
    expect(classifyRisks({ ...base, yearsExp: 0, priorSeasonGames: 0, priorTeam: null, adpDelta: -40, isKeeper: true })).toEqual(['rookie']);
    expect(classifyRisks({ ...base, position: 'QB', teamQbChanged: true })).toEqual([]);
  });

  it('compares sportsbook lines with the projection only on priced markets', () => {
    const gap = sportsbookProjectionGap(
      [{ market: 'rushingYards', line: 1100 }, { market: 'rushingYards', line: 900 }, { market: 'rushingTouchdowns', line: 8.5 }, { market: 'milestones', line: 1 }],
      { rushingYards: 800, rushingTouchdowns: 7, receptions: 50 },
      scoring
    );
    // Books: 100 + 51 = 151 points; projection: 80 + 42 = 122 points.
    expect(gap).toEqual({ gap: 0.238, markets: 2 });
    expect(sportsbookProjectionGap([], { rushingYards: 800 }, scoring)).toBeNull();
  });
});

describe('acquisitions', () => {
  it('attributes a started player to the latest add on or before that week, else the draft', () => {
    const adds = new Map([['4:p1', [
      { week: 3, created: 30, rosterId: 4, playerId: 'p1', type: 'waiver' as const, transactionId: 't1', faabBid: 5 },
      { week: 6, created: 60, rosterId: 4, playerId: 'p1', type: 'trade' as const, transactionId: 't2', faabBid: null },
    ]]]);
    const drafted = new Map([['p2', 4], ['p1', 7]]);
    expect(acquisitionSource(4, 'p1', 2, adds, drafted)).toBe('other');
    expect(acquisitionSource(4, 'p1', 4, adds, drafted)).toBe('waiver');
    expect(acquisitionSource(4, 'p1', 6, adds, drafted)).toBe('trade');
    expect(acquisitionSource(4, 'p2', 6, adds, drafted)).toBe('draft');
  });

  it('keeps separate pickups of the same player by the same roster as separate stints', () => {
    const adds = new Map([['4:p1', [
      { week: 2, created: 20, rosterId: 4, playerId: 'p1', type: 'waiver' as const, transactionId: 'w1', faabBid: 12 },
      { week: 5, created: 50, rosterId: 4, playerId: 'p1', type: 'free_agent' as const, transactionId: 'f1', faabBid: null },
    ]]]);
    const row = (points: number, started: boolean) => ({ roster_id: 4, players: ['p1'], starters: started ? ['p1'] : [], players_points: { p1: points } });
    const stints = pickupStints([
      { week: 2, rows: [row(10, true)] }, { week: 3, rows: [row(4, false)] }, { week: 5, rows: [row(20, true)] }, { week: 6, rows: [row(7, true)] },
    ], adds, 6);
    expect(stints).toEqual([
      { transactionId: 'w1', rosterId: 4, playerId: 'p1', firstWeek: 2, source: 'waiver', faabBid: 12, rostered: 14, started: 10 },
      { transactionId: 'f1', rosterId: 4, playerId: 'p1', firstWeek: 5, source: 'free_agent', faabBid: null, rostered: 27, started: 27 },
    ]);
  });
});

describe('parsing helpers', () => {
  it('parses quoted CSV fields and normalizes player names', () => {
    expect(parseCsv('id,name,url\r\n1,"Smith, Jr.","a ""b"""\n2,Lee,\n')).toEqual([
      ['id', 'name', 'url'], ['1', 'Smith, Jr.', 'a "b"'], ['2', 'Lee', ''],
    ]);
    expect(normalizeName("Travis Etienne Jr.")).toBe(normalizeName('Travis Etienne'));
    expect(normalizeName("Ja'Marr Chase")).toBe('jamarr chase');
  });
});

describe('season review entry decisions', () => {
  it('parses flags after pnpm forwarding and rejects unknown or non-numeric values', () => {
    const options = parseSeasonReviewArgs(['--', '--season', '2026', '--through-week', '11', '--out', 'reports'], '/work');
    expect(options).toMatchObject({ season: 2026, throughWeek: 11, outDir: '/work/reports', managerSlot: null });
    expect(() => parseSeasonReviewArgs(['--seasons', '2026'], '/work')).toThrow('Unknown option');
    expect(() => parseSeasonReviewArgs(['--season', 'next'], '/work')).toThrow('positive integer');
  });

  it('refuses to guess the manager slot when evidence is missing or conflicting', () => {
    expect(resolveManagerSlot(null, [{ source: 'keepers', slot: 5 }, { source: 'rehearsal', slot: 5 }]).slot).toBe(5);
    expect(() => resolveManagerSlot(null, [{ source: 'keepers', slot: 5 }, { source: 'rehearsal', slot: 6 }])).toThrow('disagrees');
    expect(() => resolveManagerSlot(null, [])).toThrow('--manager-slot');
    expect(resolveManagerSlot(3, [{ source: 'keepers', slot: 5 }]).slot).toBe(3);
  });

  it('stops at the last fully scored week before the in-progress week', () => {
    const points = new Map([[10, 1400], [11, 1259], [12, 35]]);
    expect(lastScoredWeek(12, 2026, 2026, points)).toBe(11);
    expect(lastScoredWeek(3, 2027, 2026, new Map([[17, 1300], [18, 0]]))).toBe(17);
  });

  it('runs only through the last completed week, bounded by the league last_scored_leg', () => {
    expect(resolveThroughWeek(null, 12, 11)).toBe(11);
    expect(resolveThroughWeek(11, 11, null)).toBe(11);
    expect(() => resolveThroughWeek(12, 12, 11)).toThrow('last completed week');
    expect(() => resolveThroughWeek(9, 11, 11)).toThrow('standings are live');
    expect(() => resolveThroughWeek(null, 0, null)).toThrow('No scored weeks');
  });

  it('accepts only a same-season FantasyPros snapshot refreshed before the draft', () => {
    const draftStart = Date.parse('2026-09-05T20:00:00Z');
    expect(predraftSnapshotProblem({ season: 2026, refreshedAt: '2026-08-30T21:16:15Z' }, 2026, draftStart)).toBeNull();
    expect(predraftSnapshotProblem({ season: 2025, refreshedAt: '2025-08-30T21:16:15Z' }, 2026, draftStart)).toContain('season 2025');
    expect(predraftSnapshotProblem({ season: 2026, refreshedAt: '2026-10-01T00:00:00Z' }, 2026, draftStart)).toContain('not before the draft');
  });
});
