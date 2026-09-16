import { createElement, type EffectCallback } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDraftStore, DraftStoreProvider } from '@/stores/draftStore';
import { useSleeperDraft } from './useSleeperDraft';

const mocks = vi.hoisted(() => ({
  effects: [] as EffectCallback[],
  query: vi.fn(),
  snapshot: {
    draftId: 'Draft_1-abc',
    picks: [
      { pickNumber: 1, playerId: 'known', playerName: 'Provider Name', position: null, nflTeam: 'BUF', draftSlot: 1, teamIndex: 0 },
      { pickNumber: 2, playerId: 'defense', playerName: 'Defense', position: 'DST', nflTeam: 'BUF', draftSlot: 2, teamIndex: 1 },
      { pickNumber: 3, playerId: 'unknown', playerName: 'Unknown', position: null, nflTeam: null, draftSlot: 3, teamIndex: 2 },
    ],
  },
}));

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: (effect: EffectCallback) => { mocks.effects.push(effect); },
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: mocks.query,
  useQueryClient: () => ({ setQueryData: vi.fn() }),
}));
vi.mock('./usePlayerData', () => ({
  usePlayerDataQuery: () => ({ players: [{ id: 'known', name: 'Canonical Name', position: 'WR', team: 'BUF' }] }),
}));

function renderDraft(draftId: string) {
  const store = createDraftStore();
  let result: ReturnType<typeof useSleeperDraft> | undefined;
  function CaptureDraft() {
    result = useSleeperDraft(draftId);
    return null;
  }
  renderToString(createElement(DraftStoreProvider, {
    store,
    children: createElement(CaptureDraft),
  }));
  const cleanups = mocks.effects.map((effect) => effect());
  if (!result) throw new Error('Draft hook did not render');
  return { store, result, cleanup: () => { cleanups.forEach((cleanup) => cleanup?.()); } };
}

describe('Sleeper sync ingress and reconciliation', () => {
  const eventSource = vi.fn(function () { return { close: vi.fn() }; });
  const fetcher = vi.fn();
  beforeEach(() => {
    mocks.effects.length = 0;
    mocks.query.mockReset().mockReturnValue({ data: mocks.snapshot });
    eventSource.mockClear();
    fetcher.mockReset().mockResolvedValue({ ok: true, json: async () => mocks.snapshot });
    vi.stubGlobal('EventSource', eventSource);
    vi.stubGlobal('fetch', fetcher);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('retains unresolved identities without changing canonical picks or the provider cursor', () => {
    const { store, cleanup } = renderDraft('Draft_1-abc');
    expect(store.getState().draftHistory.map((pick) => [pick.playerId, pick.position]))
      .toEqual([['known', 'WR'], ['defense', 'DEF']]);
    expect(store.getState().draftHistory[0]?.playerName).toBe('Canonical Name');
    expect(store.getState().currentPick).toBe(4);
    expect(store.getState().unresolvedProviderPicks).toEqual([{
      pickNumber: 3, playerId: 'unknown', playerName: 'Unknown', nflTeam: null,
    }]);
    cleanup();
  });

  it.each(['../draft', 'draft/events', 'draft?refresh', ' ', 'a'.repeat(129)])(
    'does not start requests or refresh for invalid ID %j', async (draftId) => {
      mocks.query.mockReturnValue({ data: undefined });
      const { result, cleanup } = renderDraft(draftId);
      const options = mocks.query.mock.calls[0]?.[0] as { enabled: boolean };
      expect(options.enabled).toBe(false);
      await result.refresh();
      expect(eventSource).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
      cleanup();
    }
  );

  it('uses the valid identifier for snapshot, stream, and refresh requests', async () => {
    const { result, cleanup } = renderDraft('Draft_1-abc');
    const options = mocks.query.mock.calls[0]?.[0] as { enabled: boolean; queryFn: () => Promise<unknown> };
    expect(options.enabled).toBe(true);
    await options.queryFn();
    await result.refresh();
    expect(fetcher).toHaveBeenCalledWith('/api/sync/drafts/Draft_1-abc');
    expect(eventSource).toHaveBeenCalledWith('/api/sync/drafts/Draft_1-abc/events');
    expect(fetcher).toHaveBeenCalledWith('/api/sync/drafts/Draft_1-abc/refresh', { method: 'POST' });
    cleanup();
  });
});
