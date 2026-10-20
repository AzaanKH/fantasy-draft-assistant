import { describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import type { SleeperDraftMetadata } from '@fantasy-draft/shared/sync';
import {
  draftFixture,
  leagueFixture,
  picksFixture,
} from './__fixtures__/sleeper-fixtures.js';
import { SLEEPER_API_BASE, SLEEPER_SETTINGS_CACHE_MS, SleeperSyncAdapter } from './sleeper-adapter.js';

describe('SleeperSyncAdapter', () => {
  it('logs rejected optional league settings while preserving the atomic draft payload', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const adapter = new SleeperSyncAdapter(draftFixture.draft_id, async (url: string) => {
      if (url.endsWith('/picks')) return picksFixture;
      if (url.includes('/draft/')) return draftFixture;
      return { league_id: leagueFixture.league_id };
    });
    try {
      const snapshot = await Effect.runPromise(adapter.poll());
      expect(snapshot.draft.leagueSettings).toBeUndefined();
      expect(snapshot.picks).toHaveLength(picksFixture.length);
      expect(warning).toHaveBeenCalledWith('[sleeper-adapter] Rejected invalid league settings');
    } finally { warning.mockRestore(); }
  });

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
      async (url: string): Promise<unknown> => {
        requestedUrls.push(url);
        if (url === `${SLEEPER_API_BASE}/draft/${leagueMock.draft_id}`) {
          return leagueMock;
        }
        if (url === `${SLEEPER_API_BASE}/draft/${leagueMock.draft_id}/picks`) {
          return picksFixture;
        }
        if (url === `${SLEEPER_API_BASE}/league/${leagueFixture.league_id}`) {
          return leagueFixture;
        }
        throw new Error(`Unexpected URL: ${url}`);
      }
    );

    const snapshot = await Effect.runPromise(adapter.poll());

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
      async (url: string): Promise<unknown> => {
        if (url === `${SLEEPER_API_BASE}/draft/${draftFixture.draft_id}`) {
          return draftFixture;
        }
        if (url === `${SLEEPER_API_BASE}/draft/${draftFixture.draft_id}/picks`) {
          return picksFixture;
        }
        if (url === `${SLEEPER_API_BASE}/league/${leagueFixture.league_id}`) {
          throw new Error('League settings unavailable');
        }
        throw new Error(`Unexpected URL: ${url}`);
      }
    );

    const snapshot = await Effect.runPromise(adapter.poll());

    expect(snapshot.draft.leagueId).toBe(leagueFixture.league_id);
    expect(snapshot.draft.leagueSettings).toBeUndefined();
    expect(snapshot.picks).toHaveLength(picksFixture.length);
  });
});

describe('Sleeper settings cache', () => {
  function setup() {
    let leagueId = leagueFixture.league_id;
    let rejectSettings = false;
    let settingsRequests = 0;
    const adapter = new SleeperSyncAdapter(draftFixture.draft_id, async (url: string): Promise<unknown> => {
      if (url.endsWith('/picks')) return picksFixture;
      if (url.includes('/draft/')) return { ...draftFixture, league_id: leagueId };
      settingsRequests += 1;
      if (rejectSettings) throw new Error('Settings unavailable');
      return { ...leagueFixture, league_id: leagueId };
    });
    return { adapter, count: () => settingsRequests,
      changeLeague: () => { leagueId = 'another-league'; },
      fail: () => { rejectSettings = true; } };
  }

  it('reuses verified settings, but verifies again on expiry and explicit reconnect', async () => {
    vi.useFakeTimers();
    try {
      const test = setup();
      const first = await Effect.runPromise(test.adapter.poll());
      expect((await Effect.runPromise(test.adapter.poll())).draft.leagueSettings).toBe(first.draft.leagueSettings);
      expect(test.count()).toBe(1);
      vi.advanceTimersByTime(SLEEPER_SETTINGS_CACHE_MS);
      await Effect.runPromise(test.adapter.poll());
      expect(test.count()).toBe(2);
      test.adapter.invalidateSettings();
      await Effect.runPromise(test.adapter.poll());
      expect(test.count()).toBe(3);
    } finally { vi.useRealTimers(); }
  });

  it('does not reuse settings from a different league', async () => {
    const test = setup();
    await Effect.runPromise(test.adapter.poll());
    test.changeLeague();
    const changed = await Effect.runPromise(test.adapter.poll());
    expect(test.count()).toBe(2);
    expect(changed.draft.leagueSettings?.leagueId).toBe('another-league');
  });

  it('keeps picks but drops expired settings after a refresh failure', async () => {
    vi.useFakeTimers();
    try {
      const test = setup();
      await Effect.runPromise(test.adapter.poll());
      vi.advanceTimersByTime(SLEEPER_SETTINGS_CACHE_MS);
      test.fail();
      const failedRefresh = await Effect.runPromise(test.adapter.poll());
      expect(failedRefresh.draft.leagueSettings).toBeUndefined();
      expect(failedRefresh.picks).toHaveLength(picksFixture.length);
      expect((await Effect.runPromise(test.adapter.poll())).draft.leagueSettings).toBeUndefined();
      expect(test.count()).toBe(3);
    } finally { vi.useRealTimers(); }
  });
});
