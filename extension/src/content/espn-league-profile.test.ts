import { describe, expect, it } from 'vitest';
import {
  ESPN_ACTIVE_LEAGUE_ID,
  getEspnLeagueSettingsProfile,
} from './espn-league-profile';

describe('active ESPN league profile', () => {
  it('matches the signed-in 2026 ESPN league settings', () => {
    const settings = getEspnLeagueSettingsProfile(ESPN_ACTIVE_LEAGUE_ID, 1234);

    expect(settings).toMatchObject({
      source: 'espn',
      leagueId: ESPN_ACTIVE_LEAGUE_ID,
      totalTeams: 14,
      keepersEnabled: false,
      scoringRules: {
        rushing: { attemptBonus: 0 },
        receiving: { reception: 1, tePremium: 0 },
      },
      rosterRequirements: {
        QB: { starters: 1, max: 4 },
        RB: { starters: 2, max: 8 },
        WR: { starters: 2, max: 8 },
        TE: { starters: 1, max: 3 },
        FLEX: { starters: 1, eligiblePositions: ['RB', 'WR', 'TE'] },
        K: { starters: 1, max: 3 },
        DEF: { starters: 1, max: 3 },
        BENCH: { spots: 8 },
      },
      updatedAt: 1234,
    });
  });

  it('does not apply the personal profile to another ESPN league', () => {
    expect(getEspnLeagueSettingsProfile('4242', 1234)).toBeUndefined();
  });
});
