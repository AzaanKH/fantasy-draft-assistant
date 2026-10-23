import { describe, expect, it } from 'vitest';
import { DEFAULT_ROSTER_REQUIREMENTS } from '@fantasy-draft/shared/league';
import { createDraftStore } from '@/stores/draftStore';
import { getDraftView } from '@/workspace/useDraftView';

function managerStore(): ReturnType<typeof createDraftStore> {
  const store = createDraftStore();
  store.getState().setConfig({ myPickPosition: 1 });
  store.getState().setSessionMode('mock');
  return store;
}

describe('derived draft permissions', () => {
  it('keeps live and setup workspaces read-only', () => {
    const store = managerStore();
    for (const mode of ['live', 'setup'] as const) {
      store.getState().setSessionMode(mode);
      expect(getDraftView(store).canDraft).toBe(false);
    }
  });

  it('allows local pick mutation only during a manager mock turn', () => {
    const store = managerStore();
    expect(getDraftView(store).canDraft).toBe(true);
    store.setState({ draftProgress: { anchor: { kind: 'carry', pickNumber: 2 }, historyLength: 0 } });
    expect(getDraftView(store).canDraft).toBe(false);
  });

  it('reserves the manager keeper slot', () => {
    const store = managerStore();
    store.getState().preloadKeepers([{
      playerId: 'keeper', playerName: 'Keeper', position: 'RB', teamIndex: 0, round: 1, isMyKeeper: true,
    }]);
    expect(getDraftView(store).isMyTurn).toBe(true);
    expect(getDraftView(store).canDraft).toBe(false);
  });

  it('blocks a position once canonical keeper supply fills its maximum', () => {
    const store = managerStore();
    expect(getDraftView(store).canDraftByPosition.K).toBe(DEFAULT_ROSTER_REQUIREMENTS.K.max > 0);
    store.getState().preloadKeepers(Array.from({ length: DEFAULT_ROSTER_REQUIREMENTS.K.max }, (_, index) => ({
      playerId: `k-${String(index)}`, playerName: `Kicker ${String(index)}`, position: 'K',
      teamIndex: 0, round: index + 2, isMyKeeper: true,
    })));
    expect(getDraftView(store).canDraft).toBe(true);
    expect(getDraftView(store).canDraftByPosition.K).toBe(false);
  });

  it('blocks a position the league does not roster', () => {
    const store = managerStore();
    store.getState().setRosterRequirements({ ...DEFAULT_ROSTER_REQUIREMENTS, DEF: { starters: 0, max: 0 } });
    expect(getDraftView(store).canDraft).toBe(true);
    expect(getDraftView(store).canDraftByPosition.DEF).toBe(false);
  });
});
