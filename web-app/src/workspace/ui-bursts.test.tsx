// @vitest-environment jsdom
import { currentSeason } from '@fantasy-draft/shared/league';
import { act, createElement, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openDraftDatabase } from './indexed-db';
import { decodeIndexedSession } from './idb-session';
import { createDurableWorkspace } from './durable-workspace';
import { WorkspaceProvider } from './WorkspaceProvider';
import { observeDurableWorkspace } from './ui-dispatch';
import { useDraftPlayerAction } from '@/hooks/useDraftPlayerAction';
import { useSimulateNextCpuPick } from '@/features/draft-board/mock-auto-advance';
import { useQueueActions } from '@/hooks/useQueueActions';
import { useDraftSyncReconciliation } from '@/hooks/useDraftSyncReconciliation';
import { useKeeperPreload } from '@/hooks/useKeeperPreload';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useDraftState } from './WorkspaceProvider';
import { VISUAL_PLAYERS } from '@/visual/VisualApp';
import type { DraftSyncSnapshot } from '@fantasy-draft/shared/sync';

vi.mock('@fantasy-draft/shared/sync', async importOriginal => ({ ...await importOriginal<object>(), STORAGE_ACTIVATION_ENABLED: true }));
vi.mock('@/hooks/usePlayerData', () => ({ usePlayerDataQuery: () => ({ players: VISUAL_PLAYERS, isLoading: false }) }));
vi.mock('@/hooks/useLeagueTimingEvidence', () => ({ useLeagueTimingEvidence: () => ({ model: null, isLoading: false }) }));
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const first = VISUAL_PLAYERS[0]; const second = VISUAL_PLAYERS[1];
if (!first || !second) throw new Error('Missing player fixtures');
async function owner() {
  const database = await openDraftDatabase({ factory: new IDBFactory(), decode: decodeIndexedSession, report: () => undefined });
  return createDurableWorkspace({ database, search: '', initialConnection: null });
}

it('refuses a second user pick issued before the first receipt settles', async () => {
  const raw = await owner(); const workspace = observeDurableWorkspace(raw);
  await raw.sendDurable(['setConfig', { totalTeams: 2, totalRounds: 3, myPickPosition: 1, draftType: 'linear' }]);
  await raw.sendDurable(['setSessionMode', 'mock']);
  let actions: ReturnType<typeof useDraftPlayerAction> | undefined;
  function Consumer() { actions = useDraftPlayerAction(); return null; }
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    act(() => { root.render(createElement(WorkspaceProvider, { workspace, children: createElement(Consumer) })); });
    await act(async () => { actions?.draftPlayer(first); actions?.draftPlayer(second); await raw.sendDurable(['setSearchQuery', 'drain']); });
    expect(raw.draft.getState().draftHistory.map(({ pickNumber, teamIndex, playerId }) => ({ pickNumber, teamIndex, playerId })))
      .toEqual([{ pickNumber: 1, teamIndex: 0, playerId: first.id }]);
    expect(workspace.status?.getState().error).toContain('draft changed');
  } finally { act(() => { root.unmount(); }); raw.dispose(); }
});

it('refuses a stale CPU selection and keeps the following user pick on its own team', async () => {
  const raw = await owner(); const workspace = observeDurableWorkspace(raw);
  await raw.sendDurable(['setConfig', { totalTeams: 2, totalRounds: 14, myPickPosition: 2, draftType: 'linear' }]);
  await raw.sendDurable(['setSessionMode', 'mock']);
  let cpu: ReturnType<typeof useSimulateNextCpuPick> | undefined;
  let user: ReturnType<typeof useDraftPlayerAction> | undefined;
  function Consumer() { cpu = useSimulateNextCpuPick(VISUAL_PLAYERS); user = useDraftPlayerAction(); return null; }
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    act(() => { root.render(createElement(WorkspaceProvider, { workspace, children: createElement(Consumer) })); });
    let results: PromiseSettledResult<boolean>[] = [];
    await act(async () => { results = await Promise.allSettled([Promise.resolve(cpu?.() ?? false), Promise.resolve(cpu?.() ?? false)]); });
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
    const available = VISUAL_PLAYERS.find(player => !raw.draft.getState().draftHistory.some(pick => pick.playerId === player.id));
    if (!available) throw new Error('Missing available player');
    await act(async () => { user?.draftPlayer(available); await raw.sendDurable(['setSearchQuery', 'drain']); });
    expect(raw.draft.getState().draftHistory.map(({ pickNumber, teamIndex }) => ({ pickNumber, teamIndex })))
      .toEqual([{ pickNumber: 1, teamIndex: 0 }, { pickNumber: 2, teamIndex: 1 }]);
  } finally { act(() => { root.unmount(); }); raw.dispose(); }
});

it('submits one reconciliation for an unchanged snapshot and retains its committed feedback', async () => {
  const raw = await owner();
  await raw.sendDurable(['connection.startConnection', 'sleeper', '123']);
  await raw.sendDurable(['setSessionMode', 'live']);
  await raw.sendDurable(['recordProvisionalPick', { pickNumber: 1, playerId: first.id, playerName: first.name, position: first.position, teamIndex: 0, teamName: 'My Team' }]);
  let calls = 0;
  let release = () => {}; let committed = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const receiptCommitted = new Promise<void>(resolve => { committed = resolve; });
  const workspace = { ...raw, sendDurable: async (command: Parameters<typeof raw.sendDurable>[0]) => {
    if (command[0] === 'reconcileSyncedPicks') calls++;
    const receipt = await raw.sendDurable(command);
    if (command[0] === 'reconcileSyncedPicks') { committed(); await gate; }
    return receipt;
  } };
  const snapshot: DraftSyncSnapshot = { provider: 'sleeper', draftId: '123', status: 'synced', draft: null, picks: [], lastSuccessfulSyncAt: 100, lastError: null, lastPolledAt: 100 };
  let sync: ReturnType<typeof useDraftSyncReconciliation> | undefined;
  function Consumer() { sync = useDraftSyncReconciliation('sleeper', '123', snapshot, true); return null; }
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    act(() => { root.render(createElement(WorkspaceProvider, { workspace, children: createElement(Consumer) })); });
    await act(async () => { await receiptCommitted; await raw.sendDurable(['setSearchQuery', 'drain']); });
    expect(calls).toBe(1);
    await act(async () => { release(); await raw.sendDurable(['setSearchQuery', 'drain']); });
    for (let attempt = 0; attempt < 5; attempt++) await act(async () => { await raw.sendDurable(['setSearchQuery', 'drain']); });
    expect(raw.draft.getState().draftHistory).toHaveLength(0);
    expect(sync?.reconciliationSummary?.removals).toHaveLength(1);
    expect(calls).toBe(1);
  } finally { release(); act(() => { root.unmount(); }); raw.dispose(); }
});


it('persists a newer unchanged sync boundary before reload so older cached history cannot remove an acknowledged pick', async () => {
  const messages = vi.fn();
  vi.stubGlobal('BroadcastChannel', class { postMessage = messages; addEventListener() {} removeEventListener() {} close() {} });
  const factory = new IDBFactory();
  const identity = { provider: 'sleeper', draftId: '123', draftPosition: 1 } as const;
  const database = await openDraftDatabase({ factory, decode: decodeIndexedSession, report: () => undefined });
  const raw = createDurableWorkspace({ database, search: '', initialConnection: identity });
  await raw.sendDurable(['setSessionMode', 'live']);
  const calls = vi.spyOn(raw, 'sendDurable');
  const container = document.createElement('div'); const root = createRoot(container);
  let feedback: ReturnType<typeof useDraftSyncReconciliation> | undefined;
  function Consumer({ at, status = 'synced' }: { readonly at: number; readonly status?: DraftSyncSnapshot['status'] }) {
    const snapshot: DraftSyncSnapshot = { provider: 'sleeper', draftId: '123', status, draft: null, picks: [], lastSuccessfulSyncAt: at, lastPolledAt: at, lastError: null };
    feedback = useDraftSyncReconciliation('sleeper', '123', snapshot, true); return null;
  }
  async function render(at: number, status: DraftSyncSnapshot['status'] = 'synced') {
    await act(async () => { root.render(createElement(WorkspaceProvider, { workspace: raw, children: createElement(Consumer, { at, status }) })); });
    await act(async () => { await raw.sendDurable(['setSearchQuery', 'drain']); });
  }
  try {
    await render(100);
    const revision = (await database.read(identity))?.revision;
    messages.mockClear();
    await render(100, 'syncing');
    await render(200);
    expect((await database.read(identity))?.revision).toBe(revision);
    expect(messages).not.toHaveBeenCalled();
    expect(calls.mock.calls.filter(([command]) => command[0] === 'reconcileSyncedPicks')).toHaveLength(1);
    expect(calls.mock.calls.filter(([command]) => command[0] === 'advanceSyncFreshness')).toHaveLength(1);
    expect(feedback?.lastReconciledSnapshotAt).toBe(200);
    expect((await database.read(identity))?.lastConfirmedSyncAt).toBe(200);
  } finally { act(() => { root.unmount(); }); raw.dispose(); }
  const reopenedDatabase = await openDraftDatabase({ factory, decode: decodeIndexedSession, report: () => undefined });
  const reopened = createDurableWorkspace({ database: reopenedDatabase, search: '', initialConnection: identity });
  try {
    await reopened.sendDurable(['setSessionMode', 'live']);
    const baseline = reopened.draft.getState().lastConfirmedSyncAt;
    if (baseline === null) throw new Error('Missing persisted sync boundary');
    await reopened.sendDurable(['enterManualContinuity', baseline]);
    const accepted = await reopened.sendDurable(['recordProvisionalPick', { pickNumber: 1, playerId: first.id, playerName: first.name, position: first.position, teamIndex: 0, teamName: 'My Team' }]);
    expect(accepted.result).toBe(true);
    const stale = await reopened.sendDurable(['reconcileSyncedPicks', [], 1, [], 150]);
    expect(stale.result).toMatchObject({ changed: false, removals: [] });
    expect(reopened.draft.getState().draftHistory.map(pick => pick.playerId)).toEqual([first.id]);
  } finally { reopened.dispose(); }
});


it('keeps stale queue clicks absolute and preserves the latest exact order after reload', async () => {
  const factory = new IDBFactory();
  const identity = { provider: 'sleeper', draftId: '123', draftPosition: 1 } as const;
  const database = await openDraftDatabase({ factory, decode: decodeIndexedSession, report: () => undefined });
  const raw = createDurableWorkspace({ database, search: '', initialConnection: identity });
  await raw.sendDurable(['setSessionMode', 'live']);
  let actions: ReturnType<typeof useQueueActions> | undefined;
  function Consumer() { actions = useQueueActions(VISUAL_PLAYERS); return null; }
  const root = createRoot(document.createElement('div'));
  try {
    act(() => { root.render(createElement(WorkspaceProvider, { workspace: raw, children: createElement(Consumer) })); });
    const other = await openDraftDatabase({ factory, decode: decodeIndexedSession, report: () => undefined });
    await other.update(identity, latest => {
      if (!latest) throw new Error('Missing session');
      return { session: { ...latest, revision: latest.revision + 1, shortlistedPlayerIds: ['a', 'b', first.id, 'c'] }, result: undefined };
    });
    expect(raw.draft.getState().shortlistedPlayerIds).toEqual([]);
    await act(async () => { actions?.togglePlayerQueued(first.id); actions?.togglePlayerQueued(first.id); await raw.sendDurable(['setSearchQuery', 'drain']); });
    expect((await other.read(identity))?.shortlistedPlayerIds).toEqual(['a', 'b', first.id, 'c']);
    await other.update(identity, latest => {
      if (!latest) throw new Error('Missing session');
      return { session: { ...latest, revision: latest.revision + 1, shortlistedPlayerIds: ['a', 'b', 'c'] }, result: undefined };
    });
    await act(async () => { actions?.togglePlayerQueued(first.id); await raw.sendDurable(['setSearchQuery', 'drain']); });
    expect((await other.read(identity))?.shortlistedPlayerIds).toEqual(['a', 'b', 'c']);
    other.close();
  } finally { act(() => { root.unmount(); }); raw.dispose(); }
  const reopened = await openDraftDatabase({ factory, decode: decodeIndexedSession, report: () => undefined });
  expect((await reopened.read(identity))?.shortlistedPlayerIds).toEqual(['a', 'b', 'c']);
  reopened.close();
});

it('settles bootstrap keeper preload when adopted sessions give player data new references', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ updatedAt: '2026-01-01T00:00:00.000Z', season: currentSeason(), keepers: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
  const database = await openDraftDatabase({ factory: new IDBFactory(), decode: decodeIndexedSession, report: () => undefined });
  const raw = createDurableWorkspace({ database, search: '', initialConnection: { provider: 'sleeper', draftId: '123', draftPosition: 1 } });
  await raw.sendDurable(['setSessionMode', 'live']);
  const calls = vi.spyOn(raw, 'sendDurable');
  const workspace = observeDurableWorkspace(raw);
  // Player data derives from league settings references, as usePlayerData does.
  function Consumer() {
    const leagueSettings = useDraftState(state => state.leagueSettings);
    const players = useMemo(() => leagueSettings.totalTeams > 0 ? VISUAL_PLAYERS.map(player => ({ ...player })) : [], [leagueSettings]);
    useKeeperPreload(players, false); return null;
  }
  const container = document.createElement('div'); const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  async function flush() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await raw.sendDurable(['setSearchQuery', 'drain']);
    });
  }
  try {
    act(() => { root.render(createElement(QueryClientProvider, { client }, createElement(WorkspaceProvider, { workspace, children: createElement(Consumer) }))); });
    for (let round = 0; round < 20; round++) await flush();
    const settled = calls.mock.calls.filter(([command]) => command[0] === 'preloadKeepers').length;
    for (let round = 0; round < 10; round++) await flush();
    expect(workspace.status?.getState().pending).toBe(0);
    expect(calls.mock.calls.filter(([command]) => command[0] === 'preloadKeepers')).toHaveLength(settled);
    expect(settled).toBeGreaterThan(0);
    expect(settled).toBeLessThanOrEqual(2);
  } finally { act(() => { root.unmount(); }); raw.dispose(); client.clear(); }
});
