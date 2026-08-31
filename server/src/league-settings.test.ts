import { describe, expect, it } from 'vitest';
import {
  normalizeSleeperLeagueSettings,
  type SleeperLeague,
} from '@fantasy-draft/shared';

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
