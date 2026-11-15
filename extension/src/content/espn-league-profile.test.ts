import { describe, expect, it } from 'vitest';
import { isLeagueSettings } from '@fantasy-draft/shared/league';
import {
  ESPN_ACTIVE_LEAGUE_ID,
  getEspnLeagueSettingsProfile,
} from './espn-league-profile';

describe('active ESPN league profile', () => {
  it('applies a valid ESPN profile only to the active league', () => {
    const settings = getEspnLeagueSettingsProfile(ESPN_ACTIVE_LEAGUE_ID, 1234);
    expect(isLeagueSettings(settings)).toBe(true);
    expect(settings).toMatchObject({ source: 'espn', leagueId: ESPN_ACTIVE_LEAGUE_ID, updatedAt: 1234 });
    expect(getEspnLeagueSettingsProfile('4242', 1234)).toBeUndefined();
  });
});
