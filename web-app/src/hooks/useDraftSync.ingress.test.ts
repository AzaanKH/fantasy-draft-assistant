import { createElement, type EffectCallback, type SetStateAction } from 'react';
import { renderToString } from 'react-dom/server';
import { QueryClient } from '@tanstack/react-query';
import type { DraftPickEvent, DraftSyncSnapshot } from '@fantasy-draft/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDraftStore, DraftStoreProvider } from '@/stores/draftStore';
import { useDraftSync } from './useDraftSync';

const mocks = vi.hoisted(() => ({
  effects: [] as EffectCallback[],
  states: [] as unknown[],
  queryClient: null as QueryClient | null,
  query: vi.fn(),
  snapshot: {
    draftId: 'Draft_1-abc',
    provider: 'sleeper',
    draft: null,
    picks: [],
    status: 'synced',
    lastPolledAt: 100,
    lastSuccessfulSyncAt: 100,
    lastError: null,
  },
}));

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: (effect: EffectCallback) => { mocks.effects.push(effect); },
  // Retain state updates from async handlers without requiring a browser DOM.
  useState: <T,>(initial: T | (() => T)) => {
    const index = mocks.states.length;
    mocks.states.push(typeof initial === 'function' ? (initial as () => T)() : initial);
    return [mocks.states[index], (update: SetStateAction<T>) => {
      mocks.states[index] = typeof update === 'function'
        ? (update as (current: T) => T)(mocks.states[index] as T)
        : update;
    }];
  },
}));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...await importOriginal<typeof import('@tanstack/react-query')>(),
  useQuery: mocks.query,
  useQueryClient: () => mocks.queryClient,
}));
vi.mock('./usePlayerData', () => ({
  usePlayerDataQuery: () => ({ players: [{ id: 'known', name: 'Canonical Name', position: 'WR', team: 'BUF' }] }),
}));

function renderDraft(draftId: string, store = createDraftStore()) {
  let result: ReturnType<typeof useDraftSync> | undefined;
  function CaptureDraft() {
    result = useDraftSync('sleeper', draftId);
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
  const stream = {
    close: vi.fn(),
    onmessage: null as ((event: MessageEvent<string>) => void) | null,
  };
  const eventSource = vi.fn(function () { return stream; });
  const fetcher = vi.fn();
  beforeEach(() => {
    mocks.effects.length = 0;
    mocks.states.length = 0;
    mocks.queryClient = new QueryClient();
    mocks.query.mockReset().mockReturnValue({ data: mocks.snapshot });
    stream.onmessage = null;
    eventSource.mockClear();
    fetcher.mockReset().mockResolvedValue({ ok: true, json: async () => mocks.snapshot });
    vi.stubGlobal('window', { setInterval: vi.fn(), clearInterval: vi.fn() });
    vi.stubGlobal('EventSource', eventSource);
    vi.stubGlobal('fetch', fetcher);
  });
  afterEach(() => {
    mocks.queryClient?.clear();
    vi.unstubAllGlobals();
  });

  const queryKey = ['draft-sync-snapshot', 'sleeper', 'Draft_1-abc'];
  const pick: DraftPickEvent = {
    draftId: 'Draft_1-abc', pickNumber: 1, round: 1, rosterId: 1,
    draftSlot: 1, teamIndex: 0, playerId: 'known', playerName: 'Canonical Name',
    position: 'WR', nflTeam: 'BUF', isKeeper: false,
    source: 'sleeper-api', confidence: 'confirmed', observedAt: 200,
  };
  const newerSnapshot: DraftSyncSnapshot = {
    ...mocks.snapshot, provider: 'sleeper', status: 'synced', picks: [pick],
    lastPolledAt: 200, lastSuccessfulSyncAt: 200,
  };
  function sendUpdate(update: unknown) {
    stream.onmessage?.({ data: JSON.stringify(update) } as MessageEvent<string>);
  }
  function liveSnapshot() {
    return mocks.states[0] as DraftSyncSnapshot;
  }

  it('advances the reconciled timestamp for unchanged imports without reconciling them twice', () => {
    const snapshot = { ...mocks.snapshot };
    mocks.query.mockReturnValue({ data: snapshot });
    const store = createDraftStore();
    const reconcile = vi.fn(store.getState().reconcileSyncedPicks);
    vi.spyOn(store, 'getInitialState').mockReturnValue({ ...store.getInitialState(), reconcileSyncedPicks: reconcile });
    const { cleanup } = renderDraft('Draft_1-abc', store);
    try {
      expect(reconcile).toHaveBeenCalledTimes(1);
      expect(mocks.states[2]).toBe(100);
      snapshot.lastPolledAt = 200;
      snapshot.lastSuccessfulSyncAt = 200;
      mocks.effects.at(-1)?.();
      expect(mocks.states[2]).toBe(200);
      expect(reconcile).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  it('stores the provider draft type before reconciling keeper picks', () => {
    const snapshot: DraftSyncSnapshot = {
      ...newerSnapshot,
      draft: {
        provider: 'sleeper', draftId: 'Draft_1-abc', providerKey: 'Draft_1-abc',
        status: 'drafting', type: 'linear', draftOrder: null,
        settings: { teams: 10, rounds: 14, pickTimer: 30 },
      },
    };
    mocks.query.mockReturnValue({ data: snapshot });
    const { store, cleanup } = renderDraft('Draft_1-abc');
    try {
      expect(store.getState().config.draftType).toBe('linear');
      expect(store.getState().draftHistory[0]).toMatchObject({ playerId: 'known' });
    } finally {
      cleanup();
    }
  });

  it('preserves newer streamed picks when a delayed refresh arrives before heartbeats', async () => {
    let finishRefresh!: (response: unknown) => void;
    fetcher.mockImplementationOnce(() => new Promise((resolve) => { finishRefresh = resolve; }));
    const { result, cleanup } = renderDraft('Draft_1-abc');
    try {
      const pending = result.refresh();
      sendUpdate({ type: 'snapshot', snapshot: newerSnapshot });
      expect(liveSnapshot().picks).toHaveLength(1);
      finishRefresh({ ok: true, json: async () => mocks.snapshot });
      await pending;

      expect(liveSnapshot()).toEqual(newerSnapshot);
      expect(mocks.queryClient?.getQueryData(queryKey)).toEqual(newerSnapshot);
      sendUpdate({
        type: 'heartbeat', provider: 'sleeper', draftId: 'Draft_1-abc',
        lastPolledAt: 300, lastSuccessfulSyncAt: 300,
      });
      expect(liveSnapshot()).toMatchObject({ picks: [pick], lastSuccessfulSyncAt: 300 });
      expect(mocks.queryClient?.getQueryData(queryKey)).toEqual(liveSnapshot());
    } finally {
      cleanup();
    }
  });

  it('accepts a newer refresh that removes a corrected provider pick', async () => {
    const { result, cleanup } = renderDraft('Draft_1-abc');
    try {
      sendUpdate({ type: 'snapshot', snapshot: newerSnapshot });
      const corrected = { ...newerSnapshot, picks: [], lastPolledAt: 300, lastSuccessfulSyncAt: 300 };
      fetcher.mockResolvedValueOnce({ ok: true, json: async () => corrected });
      await result.refresh();
      expect(liveSnapshot()).toEqual(corrected);
      expect(mocks.queryClient?.getQueryData(queryKey)).toEqual(corrected);
    } finally {
      cleanup();
    }
  });

  it('does not clear a newer provider error with an older successful refresh', async () => {
    const { result, cleanup } = renderDraft('Draft_1-abc');
    try {
      const failed = { ...newerSnapshot, status: 'error', lastPolledAt: 300, lastError: 'Unavailable' };
      sendUpdate({ type: 'status', snapshot: failed });
      fetcher.mockResolvedValueOnce({ ok: true, json: async () => newerSnapshot });
      await result.refresh();
      expect(liveSnapshot()).toEqual(failed);
      expect(mocks.queryClient?.getQueryData(queryKey)).toEqual(failed);
    } finally {
      cleanup();
    }
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
    expect(fetcher).toHaveBeenCalledWith('/api/sync/sleeper/drafts/Draft_1-abc');
    expect(eventSource).toHaveBeenCalledWith('/api/sync/sleeper/drafts/Draft_1-abc/events');
    expect(fetcher).toHaveBeenCalledWith('/api/sync/sleeper/drafts/Draft_1-abc/refresh', { method: 'POST' });
    cleanup();
  });
});
