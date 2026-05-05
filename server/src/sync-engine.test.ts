import { describe, expect, it } from 'vitest';
import {
  DraftSyncEngine,
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

function createPick(pickNo: number, playerId: string): SleeperDraftPick {
  return {
    round: 1,
    roster_id: pickNo,
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
    const engine = new DraftSyncEngine('draft-123');
    const result = engine.reconcile(createDraft(), [
      createPick(1, 'p1'),
      createPick(2, 'p2'),
    ]);

    expect(result.newPicks).toHaveLength(2);
    expect(result.snapshot.picks).toHaveLength(2);
    expect(result.snapshot.picks[0]?.pickNumber).toBe(1);
    expect(result.snapshot.status).toBe('synced');
  });

  it('does not emit duplicate picks on later snapshots', () => {
    const engine = new DraftSyncEngine('draft-123');
    engine.reconcile(createDraft(), [createPick(1, 'p1')]);

    const result = engine.reconcile(createDraft(), [
      createPick(1, 'p1'),
      createPick(2, 'p2'),
    ]);

    expect(result.newPicks).toHaveLength(1);
    expect(result.newPicks[0]?.pickNumber).toBe(2);
    expect(result.snapshot.picks).toHaveLength(2);
  });

  it('tracks sync failures in snapshot state', () => {
    const engine = new DraftSyncEngine('draft-123');
    engine.beginSync(100);
    const snapshot = engine.failSync('boom', 200);

    expect(snapshot.status).toBe('error');
    expect(snapshot.lastError).toBe('boom');
    expect(snapshot.lastPolledAt).toBe(200);
  });
});
