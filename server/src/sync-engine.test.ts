import { describe, expect, it } from 'vitest';
import {
  DraftSyncEngine,
  isDraftMetadata,
  isDraftSyncUpdate,
  isSleeperDraftPick,
  isSleeperDraftMetadata,
  normalizeSleeperDraftMetadata,
  normalizeSleeperPick,
  resolveSleeperDraftLeagueId,
  type SleeperDraftMetadata,
  type SleeperDraftPick,
} from '@fantasy-draft/shared';

function createDraft(): SleeperDraftMetadata {
  return {
    draft_id: 'draft-123',
    status: 'drafting',
    type: 'snake',
    settings: {
      teams: 10,
      rounds: 15,
      pick_timer: 30,
    },
    draft_order: null,
  };
}

function createPick(
  pickNo: number,
  playerId: string,
  rosterId: number | null = pickNo
): SleeperDraftPick {
  return {
    round: 1,
    roster_id: rosterId,
    player_id: playerId,
    picked_by: `user-${pickNo}`,
    pick_no: pickNo,
    metadata: {
      first_name: `Player`,
      last_name: `${pickNo}`,
      position: 'WR',
      team: 'DET',
      status: 'Active',
    },
    is_keeper: null,
    draft_slot: pickNo,
    draft_id: 'draft-123',
  };
}

describe('DraftSyncEngine', () => {
  it('records new picks from a snapshot', () => {
    const engine = new DraftSyncEngine('sleeper', 'draft-123');
    const result = engine.reconcile(normalizeSleeperDraftMetadata(createDraft()), [
      createPick(1, 'p1'),
      createPick(2, 'p2'),
    ].map(normalizeSleeperPick));

    expect(result.newPicks).toHaveLength(2);
    expect(result.snapshot.picks).toHaveLength(2);
    expect(result.snapshot.picks[0]?.pickNumber).toBe(1);
    expect(result.snapshot.status).toBe('synced');
  });

  it('does not emit duplicate picks on later snapshots', () => {
    const engine = new DraftSyncEngine('sleeper', 'draft-123');
    engine.reconcile(
      normalizeSleeperDraftMetadata(createDraft()),
      [createPick(1, 'p1')].map(normalizeSleeperPick)
    );

    const result = engine.reconcile(normalizeSleeperDraftMetadata(createDraft()), [
      createPick(1, 'p1'),
      createPick(2, 'p2'),
    ].map(normalizeSleeperPick));

    expect(result.newPicks).toHaveLength(1);
    expect(result.newPicks[0]?.pickNumber).toBe(2);
    expect(result.snapshot.picks).toHaveLength(2);
  });

  it('reconciles removed and corrected picks from the latest snapshot', () => {
    const engine = new DraftSyncEngine('sleeper', 'draft-123');
    engine.reconcile(
      normalizeSleeperDraftMetadata(createDraft()),
      [createPick(1, 'p1'), createPick(2, 'p2')].map(normalizeSleeperPick)
    );

    const result = engine.reconcile(
      normalizeSleeperDraftMetadata(createDraft()),
      [createPick(1, 'replacement')].map(normalizeSleeperPick)
    );

    expect(result.newPicks).toHaveLength(1);
    expect(result.newPicks[0]?.playerId).toBe('replacement');
    expect(result.snapshot.picks).toHaveLength(1);
    expect(result.snapshot.picks[0]?.playerId).toBe('replacement');
  });

  it('tracks sync failures in snapshot state', () => {
    const engine = new DraftSyncEngine('sleeper', 'draft-123');
    engine.beginSync(100);
    const snapshot = engine.failSync('boom', 200);

    expect(snapshot.status).toBe('error');
    expect(snapshot.lastError).toBe('boom');
    expect(snapshot.lastPolledAt).toBe(200);
  });

  it('accepts paused drafts and picks without an assigned roster', () => {
    const engine = new DraftSyncEngine('sleeper', 'draft-123');
    const pausedDraft: SleeperDraftMetadata = {
      ...createDraft(),
      status: 'paused',
    };
    const unassignedPick = createPick(1, 'p1', null);

    expect(isSleeperDraftMetadata(pausedDraft)).toBe(true);
    expect(isSleeperDraftPick(unassignedPick)).toBe(true);

    const result = engine.reconcile(
      normalizeSleeperDraftMetadata(pausedDraft),
      [normalizeSleeperPick(unassignedPick)]
    );

    expect(result.snapshot.draft?.status).toBe('paused');
    expect(result.snapshot.picks[0]?.rosterId).toBeNull();
    expect(isDraftSyncUpdate({ type: 'snapshot', snapshot: result.snapshot })).toBe(true);
  });

  it('resolves the source league from Sleeper league-mock metadata', () => {
    const leagueMock: SleeperDraftMetadata = {
      ...createDraft(),
      league_id: null,
      metadata: {
        league_id: 'league-123',
        type: 'league_mock',
      },
    };

    expect(isSleeperDraftMetadata(leagueMock)).toBe(true);
    expect(resolveSleeperDraftLeagueId(leagueMock)).toBe('league-123');
    expect(normalizeSleeperDraftMetadata(leagueMock).leagueId).toBe('league-123');
    expect(isSleeperDraftMetadata({
      ...leagueMock,
      metadata: { league_id: 123 },
    })).toBe(false);
  });

  it('preserves an unrecognized Sleeper position as null', () => {
    const unknownPositionPick = createPick(1, 'p1');
    const normalizedPick = normalizeSleeperPick({
      ...unknownPositionPick,
      metadata: unknownPositionPick.metadata
        ? {
          ...unknownPositionPick.metadata,
          position: 'ATH',
        }
        : null,
    });

    expect(normalizedPick.position).toBeNull();
    expect(
      normalizeSleeperPick({
        ...unknownPositionPick,
        metadata: null,
      }).position
    ).toBeNull();

    const engine = new DraftSyncEngine('sleeper', 'draft-123');
    const result = engine.reconcile(
      normalizeSleeperDraftMetadata(createDraft()),
      [normalizedPick]
    );

    expect(
      isDraftSyncUpdate({ type: 'snapshot', snapshot: result.snapshot })
    ).toBe(true);
    expect(
      isDraftSyncUpdate({
        type: 'snapshot',
        snapshot: {
          ...result.snapshot,
          picks: [{ ...normalizedPick, position: 'ATH' }],
        },
      })
    ).toBe(false);
  });

  it('rejects malformed draft orders and sync updates at runtime boundaries', () => {
    expect(isSleeperDraftMetadata({ ...createDraft(), draft_order: ['not-a-slot'] })).toBe(false);
    expect(isSleeperDraftMetadata({ ...createDraft(), draft_order: { user: '1' } })).toBe(false);
    expect(isDraftMetadata({
      ...normalizeSleeperDraftMetadata(createDraft()),
      draftOrder: { user: '1' },
    })).toBe(false);
    expect(isDraftSyncUpdate({ type: 'snapshot', snapshot: { draftId: 'draft-123' } })).toBe(false);
  });
});
