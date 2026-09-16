import { describe, expect, it } from 'vitest';
import { getTeamByeWeeks } from '@fantasy-draft/shared';

describe('ECR scraper bye weeks', () => {
  it('uses the requested season and ignores missing or invalid bye weeks', () => {
    const byTeam = getTeamByeWeeks({
      metadata: { season: 2026 },
      rankings: [
        { team: 'CIN', byeWeek: 6 },
        { team: 'CIN', byeWeek: 0 },
        { team: 'DET', byeWeek: 25 },
        { team: 'ATL' },
        null,
      ],
    }, 2026);

    expect([...byTeam]).toEqual([['CIN', 6]]);
  });

  it('rejects a prior-season cache instead of publishing old bye weeks', () => {
    expect(() => getTeamByeWeeks({
      metadata: { season: 2025 },
      rankings: [{ team: 'CIN', byeWeek: 10 }],
    }, 2026)).toThrow('Refresh the FantasyPros snapshot for 2026');
    expect(() => getTeamByeWeeks(null, 2026)).toThrow('Refresh');
  });
});
