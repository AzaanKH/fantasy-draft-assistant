// @vitest-environment jsdom
import { act, createElement } from 'react';
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
import { useDraftSyncReconciliation } from '@/hooks/useDraftSyncReconciliation';
import { VISUAL_PLAYERS } from '@/visual/VisualApp';
import type { DraftSyncSnapshot } from '@fantasy-draft/shared/sync';

vi.mock('@/hooks/usePlayerData', () => ({ usePlayerDataQuery: () => ({ players: VISUAL_PLAYERS, isLoading: false }) }));
vi.mock('@/hooks/useLeagueTimingEvidence', () => ({ useLeagueTimingEvidence: () => ({ model: null, isLoading: false }) }));
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); });
afterEach(() => { vi.unstubAllGlobals(); });
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
  const workspace = { ...raw, sendDurable: async (command: Parameters<typeof raw.sendDurable>[0]) => {
    if (command[0] === 'reconcileSyncedPicks') calls++;
    const receipt = await raw.sendDurable(command);
    if (command[0] === 'reconcileSyncedPicks') await new Promise<void>(resolve => { setTimeout(resolve, 10); });
    return receipt;
  } };
  const snapshot: DraftSyncSnapshot = { provider: 'sleeper', draftId: '123', status: 'synced', draft: null, picks: [], lastSuccessfulSyncAt: 100, lastError: null, lastPolledAt: 100 };
  let sync: ReturnType<typeof useDraftSyncReconciliation> | undefined;
  function Consumer() { sync = useDraftSyncReconciliation('sleeper', '123', snapshot, true); return null; }
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    act(() => { root.render(createElement(WorkspaceProvider, { workspace, children: createElement(Consumer) })); });
    for (let attempt = 0; attempt < 5; attempt++) await act(async () => { await raw.sendDurable(['setSearchQuery', 'drain']); await new Promise<void>(resolve => { setTimeout(resolve, 10); }); });
    expect(raw.draft.getState().draftHistory).toHaveLength(0);
    expect(sync?.reconciliationSummary?.removals).toHaveLength(1);
    expect(calls).toBe(1);
  } finally { act(() => { root.unmount(); }); raw.dispose(); }
});


it('persists a newer unchanged sync boundary before reload so older cached history cannot remove an acknowledged pick', async () => {
  const factory = new IDBFactory();
  const identity = { provider: 'sleeper', draftId: '123', draftPosition: 1 } as const;
  const database = await openDraftDatabase({ factory, decode: decodeIndexedSession, report: () => undefined });
  const raw = createDurableWorkspace({ database, search: '', initialConnection: identity });
  await raw.sendDurable(['setSessionMode', 'live']);
  const container = document.createElement('div'); const root = createRoot(container);
  let feedback: ReturnType<typeof useDraftSyncReconciliation> | undefined;
  function Consumer({ at }: { readonly at: number }) {
    const snapshot: DraftSyncSnapshot = { provider: 'sleeper', draftId: '123', status: 'synced', draft: null, picks: [], lastSuccessfulSyncAt: at, lastPolledAt: at, lastError: null };
    feedback = useDraftSyncReconciliation('sleeper', '123', snapshot, true); return null;
  }
  async function render(at: number) {
    await act(async () => { root.render(createElement(WorkspaceProvider, { workspace: raw, children: createElement(Consumer, { at }) })); });
    await act(async () => { await raw.sendDurable(['setSearchQuery', 'drain']); });
  }
  try {
    await render(100);
    await render(200);
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
