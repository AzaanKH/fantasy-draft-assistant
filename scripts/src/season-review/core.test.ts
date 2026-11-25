import { describe, expect, it } from 'vitest';
import { FLEX_GROUPS } from '@fantasy-draft/shared/league';
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
  replacementLevels,
  scoreStats,
  spearman,
  sportsbookProjectionGap,
  starterSlotsFromRoster,
  type RiskInput,
} from './core.js';
import { lastScoredWeek, parseSeasonReviewArgs, resolveManagerSlot } from '../generate-season-review.js';

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

  it('adds rush-attempt and TE reception bonuses to base PPR projections', () => {
    expect(leagueProjection(200, 'TE', undefined, 80, scoring)).toBe(240);
    expect(leagueProjection(200, 'RB', 250, 40, scoring)).toBe(250);
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
      { week: 3, created: 30, rosterId: 4, playerId: 'p1', type: 'waiver' as const },
      { week: 6, created: 60, rosterId: 4, playerId: 'p1', type: 'trade' as const },
    ]]]);
    const drafted = new Map([['p2', 4], ['p1', 7]]);
    expect(acquisitionSource(4, 'p1', 2, adds, drafted)).toBe('other');
    expect(acquisitionSource(4, 'p1', 4, adds, drafted)).toBe('waiver');
    expect(acquisitionSource(4, 'p1', 6, adds, drafted)).toBe('trade');
    expect(acquisitionSource(4, 'p2', 6, adds, drafted)).toBe('draft');
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
});
