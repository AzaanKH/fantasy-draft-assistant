import { describe, expect, it } from 'vitest';
import type {
  DraftPickEvent,
  Player,
} from '@fantasy-draft/shared';
import {
  DRAFT_SYNC_STALE_AFTER_MS,
  formatDraftSyncAge,
  getDraftSyncConnectionState,
  getDraftSynchronizationState,
  getNextOpenPickNumber,
  resolveDraftPickImports,
} from './useDraftSync';

function createPick(
  overrides: Partial<DraftPickEvent> = {}
): DraftPickEvent {
  return {
    draftId: 'draft-123',
    pickNumber: 1,
    round: 1,
    rosterId: 1,
    draftSlot: 1,
    teamIndex: 0,
    playerId: 'provider-player-1',
    playerName: 'Test Player',
    position: null,
    nflTeam: 'DET',
    isKeeper: false,
    source: 'sleeper-api',
    confidence: 'confirmed',
    observedAt: 1,
    ...overrides,
  };
}

function createPlayer(
  overrides: Partial<Player> = {}
): Player {
  return {
    id: 'local-player-1',
    name: 'Test Player',
    position: 'WR',
    team: 'DET',
    ...overrides,
  } as Player;
}

describe('resolveDraftPickImports', () => {
  it('rejects a pick whose position and local identity are both unknown', () => {
    const result = resolveDraftPickImports(
      [createPick()],
      [],
      1
    );

    expect(result.picks).toEqual([]);
    expect(result.rejectedPicks).toEqual([
      {
        pickNumber: 1,
        playerId: 'provider-player-1',
        playerName: 'Test Player',
        nflTeam: 'DET',
      },
    ]);
  });

  it('resolves a nullable provider position after name and team matching', () => {
    const result = resolveDraftPickImports(
      [
        createPick({
          playerName: 'TEST PLAYER',
          nflTeam: 'det',
        }),
      ],
      [createPlayer()],
      1
    );

    expect(result.rejectedPicks).toEqual([]);
    expect(result.picks[0]).toMatchObject({
      playerId: 'local-player-1',
      playerName: 'Test Player',
      position: 'WR',
      isMyPick: true,
    });
  });

  it('rejects a recognized provider position when canonical identity matching fails', () => {
    const result = resolveDraftPickImports(
      [
        createPick({
          position: 'TE',
          nflTeam: null,
        }),
      ],
      [],
      2
    );

    expect(result.picks).toEqual([]);
    expect(result.rejectedPicks).toEqual([
      {
        pickNumber: 1,
        playerId: 'provider-player-1',
        playerName: 'Test Player',
        nflTeam: null,
      },
    ]);
  });

  it('uses a canonical Sleeper ID without relying on a name guess', () => {
    const result = resolveDraftPickImports(
      [
        createPick({
          playerId: 'local-player-1',
          playerName: 'Provider Name Variant',
          position: 'WR',
          nflTeam: null,
        }),
      ],
      [createPlayer()],
      1
    );

    expect(result.rejectedPicks).toEqual([]);
    expect(result.picks[0]).toMatchObject({
      playerId: 'local-player-1',
      playerName: 'Test Player',
      position: 'WR',
    });
  });

  it('matches ESPN typography to the canonical local player identity', () => {
    const result = resolveDraftPickImports(
      [
        createPick({
          playerId: '4426502',
          playerName: 'Ja’Marr Chase',
          position: 'WR',
          nflTeam: 'CIN',
          source: 'espn-extension',
        }),
      ],
      [
        createPlayer({
          id: '7564',
          name: "Ja'Marr Chase",
          team: 'CIN',
        }),
      ],
      8
    );

    expect(result.picks[0]).toMatchObject({
      playerId: '7564',
      playerName: "Ja'Marr Chase",
      position: 'WR',
    });
  });

  it('matches ESPN team aliases to canonical local player identities', () => {
    const result = resolveDraftPickImports(
      [
        createPick({
          playerId: '3121422',
          playerName: 'Terry McLaurin',
          position: 'WR',
          nflTeam: 'WSH',
          source: 'espn-extension',
        }),
      ],
      [
        createPlayer({
          id: '5927',
          name: 'Terry McLaurin',
          team: 'WAS',
        }),
      ],
      7
    );

    expect(result.picks[0]).toMatchObject({
      playerId: '5927',
      playerName: 'Terry McLaurin',
      position: 'WR',
    });
  });

  it('does not confuse an ESPN ID with an unrelated Sleeper player ID', () => {
    const result = resolveDraftPickImports(
      [
        createPick({
          playerId: '12483',
          playerName: 'Matthew Stafford',
          position: 'QB',
          nflTeam: 'LAR',
          source: 'espn-extension',
        }),
      ],
      [
        createPlayer({
          id: '12483',
          name: 'Jack Bech',
          position: 'WR',
          team: 'LV',
        }),
        createPlayer({
          id: '421',
          name: 'Matthew Stafford',
          position: 'QB',
          team: 'LAR',
        }),
      ],
      7
    );

    expect(result.picks[0]).toMatchObject({
      playerId: '421',
      playerName: 'Matthew Stafford',
      position: 'QB',
    });
  });

  it('does not import reserved keeper selections as completed live picks', () => {
    const player = createPlayer({
      id: 'provider-player-1',
      position: 'RB',
    });
    const result = resolveDraftPickImports([
      createPick({ pickNumber: 63, isKeeper: true, position: 'RB' }),
    ], [player], 1, [{
      playerId: player.id,
      playerName: player.name,
      position: player.position,
      teamIndex: 2,
      round: 7,
      isMyKeeper: false,
    }], 10);

    expect(result).toEqual({ picks: [], rejectedPicks: [] });
  });

  it('imports a provider keeper when it conflicts with the preloaded slot', () => {
    const hampton = createPlayer({
      id: '12507',
      name: 'Omarion Hampton',
      position: 'RB',
      team: 'LAC',
    });
    const result = resolveDraftPickImports([
      createPick({
        pickNumber: 28,
        round: 3,
        draftSlot: 8,
        teamIndex: 7,
        playerId: hampton.id,
        playerName: hampton.name,
        position: 'RB',
        nflTeam: 'LAC',
        isKeeper: true,
      }),
    ], [hampton], 5, [{
      playerId: hampton.id,
      playerName: hampton.name,
      position: hampton.position,
      teamIndex: 5,
      round: 3,
      isMyKeeper: false,
    }], 10);

    expect(result.rejectedPicks).toEqual([]);
    expect(result.picks).toEqual([
      expect.objectContaining({
        pickNumber: 28,
        playerId: '12507',
        teamIndex: 7,
      }),
    ]);
  });
});

describe('getNextOpenPickNumber', () => {
  it('finds the active pick without jumping to future keeper slots', () => {
    const picks = [
      createPick({ pickNumber: 1, isKeeper: false }),
      createPick({ pickNumber: 2, isKeeper: false }),
      createPick({ pickNumber: 3, isKeeper: false }),
      createPick({ pickNumber: 4, isKeeper: false }),
      createPick({ pickNumber: 7, isKeeper: true }),
      createPick({ pickNumber: 63, isKeeper: true }),
    ];

    expect(getNextOpenPickNumber(picks, 140)).toBe(5);
  });

  it('stays at the first pick when a pre-draft payload only has keepers', () => {
    const picks = [
      createPick({ pickNumber: 7, isKeeper: true }),
      createPick({ pickNumber: 9, isKeeper: true }),
    ];

    expect(getNextOpenPickNumber(picks, 140)).toBe(1);
  });
});

describe('draft sync connection state', () => {
  const now = 100_000;
  const connectedInput = {
    hasDraftId: true,
    draftStatus: 'drafting' as const,
    syncStatus: 'synced' as const,
    transportState: 'connected' as const,
    lastSuccessfulSyncAt: now - 1_000,
    isQueryLoading: false,
    isQueryError: false,
    now,
  };

  it('covers disconnected, syncing, and connected states', () => {
    expect(getDraftSyncConnectionState({
      ...connectedInput,
      hasDraftId: false,
      transportState: 'disconnected',
      lastSuccessfulSyncAt: null,
    })).toBe('disconnected');
    expect(getDraftSyncConnectionState({
      ...connectedInput,
      transportState: 'connecting',
      lastSuccessfulSyncAt: null,
      isQueryLoading: true,
    })).toBe('syncing');
    expect(getDraftSyncConnectionState(connectedInput)).toBe('connected');
  });

  it('surfaces SSE reconnection before cached data becomes stale', () => {
    expect(getDraftSyncConnectionState({
      ...connectedInput,
      transportState: 'reconnecting',
    })).toBe('reconnecting');
    expect(getDraftSyncConnectionState({
      ...connectedInput,
      transportState: 'reconnecting',
      lastSuccessfulSyncAt: now - DRAFT_SYNC_STALE_AFTER_MS,
    })).toBe('reconnecting');
  });

  it('marks an open stream stale when successful snapshots stop arriving', () => {
    expect(getDraftSyncConnectionState({
      ...connectedInput,
      lastSuccessfulSyncAt: now - DRAFT_SYNC_STALE_AFTER_MS,
    })).toBe('stale');
  });

  it('distinguishes provider and terminal transport errors from completion', () => {
    expect(getDraftSyncConnectionState({
      ...connectedInput,
      syncStatus: 'error',
    })).toBe('error');
    expect(getDraftSyncConnectionState({
      ...connectedInput,
      transportState: 'error',
    })).toBe('error');
    expect(getDraftSyncConnectionState({
      ...connectedInput,
      draftStatus: 'complete',
      syncStatus: 'error',
      transportState: 'error',
    })).toBe('complete');
  });
});

describe('draft synchronization presentation state', () => {
  it('distinguishes Provider Truth, delay, disconnect, Manual Continuity, and reconciliation', () => {
    expect(getDraftSynchronizationState('connected')).toBe('confirmed');
    expect(getDraftSynchronizationState('reconnecting')).toBe('delayed');
    expect(getDraftSynchronizationState('stale')).toBe('delayed');
    expect(getDraftSynchronizationState('error')).toBe('disconnected');
    expect(getDraftSynchronizationState('syncing')).toBe('reconciling');
    expect(getDraftSynchronizationState('reconnecting', true)).toBe(
      'manual-continuity'
    );
  });
});

describe('formatDraftSyncAge', () => {
  it('formats the age of the latest successful sync', () => {
    expect(formatDraftSyncAge(null)).toBe('not yet');
    expect(formatDraftSyncAge(0)).toBe('just now');
    expect(formatDraftSyncAge(12_900)).toBe('12s ago');
    expect(formatDraftSyncAge(120_000)).toBe('2m ago');
    expect(formatDraftSyncAge(7_200_000)).toBe('2h ago');
  });
});
