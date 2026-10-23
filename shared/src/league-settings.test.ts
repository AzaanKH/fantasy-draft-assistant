import { describe, expect, it } from 'vitest';
import {
  normalizeSleeperLeagueSettings,
  isRosterRequirements,
  isLeagueSettings,
  isSleeperLeague,
  type SleeperLeague,
} from './league-settings.js';
import {
  MAX_ROSTER_SPOTS,
} from './limits.js';
import {
  type RosterRequirements,
} from './draft.js';

function createLeague(overrides: Partial<SleeperLeague> = {}): SleeperLeague {
  return {
    league_id: 'league-1',
    total_rosters: 10,
    roster_positions: [
      'QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX',
      'BN', 'BN', 'BN', 'BN', 'BN', 'BN',
    ],
    scoring_settings: {
      pass_yd: 0.04,
      pass_td: 4,
      pass_int: -2,
      rush_yd: 0.1,
      rush_td: 6,
      rush_att: 0.2,
      rec: 1,
      rec_yd: 0.1,
      rec_td: 6,
      bonus_rec_te: 0.5,
    },
    settings: {},
    ...overrides,
  };
}

describe('normalizeSleeperLeagueSettings', () => {
  it('maps scoring and roster slots into the local calculation model', () => {
    const settings = normalizeSleeperLeagueSettings(createLeague(), 1000);

    expect(settings).toMatchObject({
      source: 'sleeper',
      leagueId: 'league-1',
      totalTeams: 10,
      scoringRules: {
        rushing: { attemptBonus: 0.2 },
        receiving: { reception: 1, tePremium: 0.5 },
      },
      rosterRequirements: {
        QB: { starters: 1 },
        RB: { starters: 2 },
        WR: { starters: 2 },
        TE: { starters: 1 },
        FLEX: { starters: 2, eligiblePositions: ['RB', 'WR', 'TE'] },
        BENCH: { spots: 6 },
      },
      updatedAt: 1000,
    });
  });

  it('changes the fingerprint only when value-relevant settings change', () => {
    const first = normalizeSleeperLeagueSettings(createLeague(), 1000);
    const same = normalizeSleeperLeagueSettings(createLeague(), 2000);
    const changedScoring = normalizeSleeperLeagueSettings(createLeague({
      scoring_settings: {
        ...createLeague().scoring_settings,
        bonus_rec_te: 1,
      },
    }), 3000);
    const changedRoster = normalizeSleeperLeagueSettings(createLeague({
      roster_positions: [...createLeague().roster_positions, 'SUPER_FLEX'],
    }), 4000);

    expect(same.fingerprint).toBe(first.fingerprint);
    expect(changedScoring.fingerprint).not.toBe(first.fingerprint);
    expect(changedRoster.fingerprint).not.toBe(first.fingerprint);
  });
});


describe('isRosterRequirements', () => {
  const atCapacity: RosterRequirements = {
    QB: { starters: 1, max: 40 },
    RB: { starters: 2, max: 40 },
    WR: { starters: 2, max: 40 },
    TE: { starters: 1, max: 40 },
    K: { starters: 1, max: 40 },
    DEF: { starters: 1, max: 40 },
    FLEX: { starters: 2, eligiblePositions: ['QB', 'RB', 'WR', 'TE'] },
    BENCH: { spots: MAX_ROSTER_SPOTS - 10 },
  };

  it('accepts capacity with overlapping FLEX eligibility and independent position maxima', () => {
    expect(isRosterRequirements(atCapacity)).toBe(true);
  });

  it.each(['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'FLEX'] as const)(
    'rejects aggregate overflow from %s starters', (position) => {
      expect(isRosterRequirements({
        ...atCapacity,
        [position]: { ...atCapacity[position], starters: atCapacity[position].starters + 1 },
      })).toBe(false);
    }
  );

  it('rejects aggregate overflow from bench spots', () => {
    expect(isRosterRequirements({
      ...atCapacity, BENCH: { spots: atCapacity.BENCH.spots + 1 },
    })).toBe(false);
  });

  it.each([-1, 0.5, MAX_ROSTER_SPOTS + 1])('preserves individual field bounds for %s', (invalid) => {
    expect(isRosterRequirements({ ...atCapacity, QB: { starters: invalid, max: 40 } })).toBe(false);
    expect(isRosterRequirements({ ...atCapacity, QB: { starters: 1, max: invalid } })).toBe(false);
    expect(isRosterRequirements({ ...atCapacity, FLEX: { ...atCapacity.FLEX, starters: invalid } })).toBe(false);
    expect(isRosterRequirements({ ...atCapacity, BENCH: { spots: invalid } })).toBe(false);
  });
});


describe('league boundary predicates', () => {
  it('validates supported Sleeper roster and scoring bounds', () => {
    expect(isSleeperLeague(createLeague())).toBe(true);
    expect(isSleeperLeague(createLeague({ total_rosters: 32, roster_positions: Array(40).fill('BN') }))).toBe(true);
    for (const total_rosters of [1, 33, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isSleeperLeague({ ...createLeague(), total_rosters })).toBe(false);
    }
    expect(isSleeperLeague(createLeague({ roster_positions: Array(41).fill('BN') }))).toBe(false);
    expect(isSleeperLeague({ ...createLeague(), roster_positions: ['QB', 1] })).toBe(false);
    expect(isSleeperLeague({ ...createLeague(), settings: [] })).toBe(false);
    expect(isSleeperLeague({ ...createLeague(), scoring_settings: { unknown: Number.NaN } })).toBe(false);
    expect(isSleeperLeague({ ...createLeague(), scoring_settings: { unknown: 3 } })).toBe(true);
  });

  it('retains finite checks on known and unknown scoring fields', () => {
    const settings = normalizeSleeperLeagueSettings(createLeague(), 1000);
    expect(isLeagueSettings(settings)).toBe(true);
    for (const group of ['passing', 'rushing', 'receiving', 'kicking', 'misc'] as const) {
      expect(isLeagueSettings({ ...settings, scoringRules: {
        ...settings.scoringRules, [group]: { ...settings.scoringRules[group], extra: 1 },
      } })).toBe(true);
      for (const extra of [Number.NaN, Number.POSITIVE_INFINITY, '1']) {
        expect(isLeagueSettings({ ...settings, scoringRules: {
          ...settings.scoringRules, [group]: { ...settings.scoringRules[group], extra },
        } })).toBe(false);
      }
    }
    for (const extra of [Number.NaN, Number.POSITIVE_INFINITY, '1']) {
      expect(isLeagueSettings({ ...settings, scoringRules: {
        ...settings.scoringRules, defense: { ...settings.scoringRules.defense, extra },
      } })).toBe(false);
      expect(isLeagueSettings({ ...settings, scoringRules: {
        ...settings.scoringRules, defense: { ...settings.scoringRules.defense,
          pointsAllowed: { ...settings.scoringRules.defense.pointsAllowed, extra },
        },
      } })).toBe(false);
    }
    expect(isLeagueSettings({ ...settings, scoringRules: {
      ...settings.scoringRules, defense: { ...settings.scoringRules.defense, extra: 1,
        pointsAllowed: { ...settings.scoringRules.defense.pointsAllowed, extra: 1 },
      },
    } })).toBe(true);
  });

  it.each(['__proto__', 'constructor', 'toString'])('checks prototype-named scoring extras as finite numbers: %s', key => {
    const settings = normalizeSleeperLeagueSettings(createLeague(), 1000);
    expect(isLeagueSettings({ ...settings, scoringRules: {
      ...settings.scoringRules, passing: { ...settings.scoringRules.passing, [key]: 1 },
    } })).toBe(true);
    expect(isLeagueSettings({ ...settings, scoringRules: {
      ...settings.scoringRules, passing: { ...settings.scoringRules.passing, [key]: {} },
    } })).toBe(false);
  });

  it('rejects each missing scoring field promised by LeagueSettings', () => {
    const settings = normalizeSleeperLeagueSettings(createLeague(), 1000);
    for (const [group, rules] of Object.entries(settings.scoringRules)) {
      for (const key of Object.keys(rules)) {
        const incomplete = Object.fromEntries(Object.entries(rules).filter(([name]) => name !== key));
        expect(isLeagueSettings({ ...settings, scoringRules: {
          ...settings.scoringRules, [group]: incomplete,
        } }), `${group}.${key}`).toBe(false);
      }
    }
    for (const key of Object.keys(settings.scoringRules.defense.pointsAllowed)) {
      const incomplete = Object.fromEntries(Object.entries(settings.scoringRules.defense.pointsAllowed)
        .filter(([name]) => name !== key));
      expect(isLeagueSettings({ ...settings, scoringRules: {
        ...settings.scoringRules, defense: { ...settings.scoringRules.defense, pointsAllowed: incomplete },
      } }), `defense.pointsAllowed.${key}`).toBe(false);
    }
  });

  it('preserves roster eligibility membership and length without inventing uniqueness or max rules', () => {
    const requirements = normalizeSleeperLeagueSettings(createLeague()).rosterRequirements;
    expect(isRosterRequirements({ ...requirements, QB: { starters: 2, max: 1 } })).toBe(true);
    expect(isRosterRequirements({ ...requirements, FLEX: { starters: 0, eligiblePositions: Array(6).fill('QB') } })).toBe(true);
    expect(isRosterRequirements({ ...requirements, FLEX: { starters: 0, eligiblePositions: Array(7).fill('QB') } })).toBe(false);
    expect(isRosterRequirements({ ...requirements, FLEX: { starters: 0, eligiblePositions: ['FLEX'] } })).toBe(false);
  });
});
