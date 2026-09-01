import { describe, expect, it } from 'vitest';
import type { SleeperDraftMetadata } from '@fantasy-draft/shared';
import {
  draftFixture,
  leagueFixture,
  picksFixture,
} from './__fixtures__/sleeper-fixtures.js';
import { SLEEPER_API_BASE, SleeperSyncAdapter } from './sleeper-adapter.js';

describe('SleeperSyncAdapter', () => {
  it('loads provider-confirmed settings for a Sleeper league mock', async () => {
    const leagueMock: SleeperDraftMetadata = {
      ...draftFixture,
      league_id: null,
      metadata: {
        league_id: leagueFixture.league_id,
        type: 'league_mock',
      },
    };
    const requestedUrls: string[] = [];
    const adapter = new SleeperSyncAdapter(
      leagueMock.draft_id,
      async <T>(url: string): Promise<T> => {
        requestedUrls.push(url);
        if (url === `${SLEEPER_API_BASE}/draft/${leagueMock.draft_id}`) {
          return leagueMock as T;
        }
        if (url === `${SLEEPER_API_BASE}/draft/${leagueMock.draft_id}/picks`) {
          return picksFixture as T;
        }
        if (url === `${SLEEPER_API_BASE}/league/${leagueFixture.league_id}`) {
          return leagueFixture as T;
        }
        throw new Error(`Unexpected URL: ${url}`);
      }
    );

    const snapshot = await adapter.poll(new AbortController().signal);

    expect(requestedUrls).toContain(
      `${SLEEPER_API_BASE}/league/${leagueFixture.league_id}`
    );
    expect(snapshot.draft.leagueId).toBe(leagueFixture.league_id);
    expect(snapshot.draft.leagueSettings).toMatchObject({
      source: 'sleeper',
      leagueId: leagueFixture.league_id,
      scoringRules: {
        receiving: { reception: 1, tePremium: 0.5 },
        rushing: { attemptBonus: 0.2 },
      },
    });
  });

  it('keeps draft metadata and picks when league settings fail', async () => {
    const adapter = new SleeperSyncAdapter(
      draftFixture.draft_id,
      async <T>(url: string): Promise<T> => {
        if (url === `${SLEEPER_API_BASE}/draft/${draftFixture.draft_id}`) {
          return draftFixture as T;
        }
        if (url === `${SLEEPER_API_BASE}/draft/${draftFixture.draft_id}/picks`) {
          return picksFixture as T;
        }
        if (url === `${SLEEPER_API_BASE}/league/${leagueFixture.league_id}`) {
          throw new Error('League settings unavailable');
        }
        throw new Error(`Unexpected URL: ${url}`);
      }
    );

    const snapshot = await adapter.poll(new AbortController().signal);

    expect(snapshot.draft.leagueId).toBe(leagueFixture.league_id);
    expect(snapshot.draft.leagueSettings).toBeUndefined();
    expect(snapshot.picks).toHaveLength(picksFixture.length);
  });
});
