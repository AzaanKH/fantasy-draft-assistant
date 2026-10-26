// @vitest-environment jsdom
import { act, createElement, Fragment, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Player } from '@fantasy-draft/shared/league';
import { createDraftStore, type DraftStoreApi } from '@/stores/draftStore';
import { IDBFactory } from 'fake-indexeddb';
import { STORAGE_ACTIVATION_ENABLED } from '@fantasy-draft/shared/sync';
import { createWorkspace, type Workspace } from '@/workspace/workspace';
import { createDurableWorkspace } from '@/workspace/durable-workspace';
import { openDraftDatabase } from '@/workspace/indexed-db';
import { decodeIndexedSession } from '@/workspace/idb-session';
import { dispatchDraftCommand } from '@/workspace/dispatch-command';
import type { DraftCommand } from '@/workspace/draft-reducer';
import { VISUAL_PLAYERS } from '@/visual/VisualApp';
import { ProvisionalPickDialog } from './ProvisionalPickDialog';
import { ManualContinuityControl } from './ManualContinuityControl';
import { useDraftState, WorkspaceProvider } from '@/workspace/WorkspaceProvider';

const activation = vi.hoisted(() => ({ enabled: false }));
vi.mock('@fantasy-draft/shared/sync', async original => ({
  ...await original<object>(), get STORAGE_ACTIVATION_ENABLED() { return activation.enabled; },
}));

const [observed, elsewhere] = VISUAL_PLAYERS;
if (!observed || !elsewhere) throw new Error('Missing player fixtures');
vi.mock('@/hooks/usePlayerData', () => ({ usePlayerDataQuery: () => ({ players: VISUAL_PLAYERS, isLoading: false }) }));
vi.mock('./LiveDraftSyncProvider', () => ({ useLiveDraftSync: () => ({ connection: { provider: 'sleeper' }, canEnterManualContinuity: true,
  synchronizationState: 'manual-continuity', lastConfirmedPickNumber: 0, provisionalPickCount: 0,
  viewState: { connectionState: 'connected' } }) }));

let v1Store: DraftStoreApi | undefined;
let workspace: Workspace;
let raw: ReturnType<typeof createDurableWorkspace> | undefined;
let other: ReturnType<typeof createDurableWorkspace> | undefined;
let root: Root;
let container: HTMLDivElement;

async function commit(command: DraftCommand): Promise<unknown> {
  if (raw) return (await raw.sendDurable(command)).result;
  if (!v1Store) throw new Error('Missing v1 store');
  return dispatchDraftCommand(v1Store.getState(), command);
}
async function elsewhereCommit(command: DraftCommand): Promise<unknown> {
  if (!other || !raw) return commit(command);
  const receipt = await other.sendDurable(command);
  window.dispatchEvent(new Event('focus'));
  await raw.sendDurable(['setSearchQuery', 'refresh drain']);
  return receipt.result;
}
function state() { return workspace.draft.getState(); }

function pick(pickNumber: number, player: Player) {
  return { pickNumber, playerId: player.id, playerName: player.name, position: player.position,
    teamIndex: pickNumber - 1, teamName: `Team ${String(pickNumber)}` };
}
function slotSelect(): HTMLSelectElement {
  const select = document.querySelector<HTMLSelectElement>('select[aria-label="Team and draft position"]');
  if (!select) throw new Error('Missing pick selector');
  return select;
}
function saveButton(correcting: boolean): HTMLButtonElement {
  const button = [...document.querySelectorAll('button')].find(button => button.textContent === (correcting ? 'Save Correction' : 'Record Provisional Pick'));
  if (!button) throw new Error('Missing save button');
  return button;
}
function choosePick(value: string): void {
  act(() => { slotSelect().value = value; slotSelect().dispatchEvent(new Event('change', { bubbles: true })); });
}

describe.each([false, true])('storage activation=%s', enabled => {
  beforeEach(async () => {
    activation.enabled = enabled;
    expect(STORAGE_ACTIVATION_ENABLED).toBe(enabled);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    // Refresh is explicit so cross-tab notification scheduling cannot race the assertions.
    vi.stubGlobal('BroadcastChannel', class { postMessage() {} addEventListener() {} removeEventListener() {} close() {} });
    if (enabled) {
      const factory = new IDBFactory();
      const database = await openDraftDatabase({ factory, decode: decodeIndexedSession, report: vi.fn() });
      const initialConnection = { provider: 'sleeper', draftId: 'dialog-conflict', draftPosition: 1 } as const;
      raw = createDurableWorkspace({ database, search: '', initialConnection });
      workspace = raw;
      await raw.sendDurable(['setConfig', { totalTeams: 4, totalRounds: 3, myPickPosition: 1, draftType: 'linear' }]);
      await raw.sendDurable(['setSessionMode', 'live']);
      const otherDatabase = await openDraftDatabase({ factory, decode: decodeIndexedSession, report: vi.fn() });
      other = createDurableWorkspace({ database: otherDatabase, search: '', initialConnection });
      await other.ready;
    } else {
      v1Store = createDraftStore({ storage: null });
      workspace = createWorkspace({ draftStore: v1Store });
      await commit(['setConfig', { totalTeams: 4, totalRounds: 3, myPickPosition: 1, draftType: 'linear' }]);
      await commit(['setSessionMode', 'live']);
    }
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(() => {
    act(() => { root.unmount(); });
    workspace.dispose(); other?.dispose(); container.remove();
    v1Store = undefined; raw = undefined; other = undefined; vi.unstubAllGlobals();
  });

  it.each([false, true])('requires an explicit new choice when another writer occupies the selected pick, correction=%s', async correcting => {
    if (correcting) expect(await commit(['recordProvisionalPick', pick(1, observed)])).toBe(true);
    const editingPick = correcting ? state().draftHistory[0] : undefined;
    const close = vi.fn();
    act(() => { root.render(createElement(WorkspaceProvider, { workspace,
      children: createElement(ProvisionalPickDialog, { open: true, onOpenChange: close, editingPick,
        initialPlayerId: observed.id }) })); });
    const selected = correcting ? 2 : 1;
    choosePick(String(selected));
    expect(slotSelect().value).toBe(String(selected));
    expect(saveButton(correcting).disabled).toBe(false);

    // ON uses another durable writer; OFF supplies the equivalent store notification.
    await act(async () => { expect(await elsewhereCommit(['recordProvisionalPick', pick(selected, elsewhere)])).toBe(true); });
    await act(async () => { saveButton(correcting).click(); await commit(['setSearchQuery', 'save drain']); });

    expect(state().draftHistory.some(row => row.pickNumber === selected + 1)).toBe(false);
    expect(close).not.toHaveBeenCalled();
    expect(slotSelect().value).toBe('');
    expect(saveButton(correcting).disabled).toBe(true);
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(`Pick ${String(selected)} was just recorded elsewhere. Choose a pick.`);
    if (correcting) expect(state().draftHistory.find(row => row.pickNumber === 1)?.playerId).toBe(observed.id);

    // Unrelated updates cannot implicitly choose a replacement position either.
    await act(async () => { await commit(['setSearchQuery', 'another render']); });
    expect(slotSelect().value).toBe('');
    choosePick(String(selected + 1));
    expect(saveButton(correcting).disabled).toBe(false);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    await act(async () => { saveButton(correcting).click(); await commit(['setSearchQuery', 'save drain']); });
    expect(state().draftHistory.find(row => row.pickNumber === selected + 1)?.playerId).toBe(observed.id);
    expect(close).toHaveBeenCalledWith(false);
  });

  interface CommittedChoice {
    readonly select: HTMLSelectElement;
    readonly value: string;
    readonly disabled: boolean;
    readonly alert: string | null;
  }

  // Observe the DOM commit that removes the occupied option, before passive effects.
  // Post-act assertions alone miss the browser's native select fallback window.
  function CommitProbe({ capture, correcting }: { readonly capture: (choice: CommittedChoice) => void; readonly correcting: boolean }) {
    const history = useDraftState(state => state.draftHistory);
    useLayoutEffect(() => {
      const select = document.querySelector<HTMLSelectElement>('select[aria-label="Team and draft position"]');
      if (select) capture({ select, value: select.value, disabled: saveButton(correcting).disabled,
        alert: document.querySelector('[role="alert"]')?.textContent ?? null });
    }, [capture, correcting, history]);
    return null;
  }

  it.each([false, true])('invalidates the real parent-opened control in the first commit without remounting, correction=%s', async correcting => {
    if (correcting) expect(await commit(['recordProvisionalPick', pick(1, observed)])).toBe(true);
    const commits: CommittedChoice[] = [];
    const capture = (choice: CommittedChoice) => { commits.push(choice); };
    act(() => { root.render(createElement(WorkspaceProvider, { workspace,
      children: createElement(Fragment, null, createElement(ManualContinuityControl), createElement(CommitProbe, { capture, correcting })) })); });
    const open = [...container.querySelectorAll('button')].find(button => correcting
      ? button.getAttribute('aria-label') === `Correct Provisional Pick for ${observed.name}`
      : button.textContent?.includes('Add Provisional Pick'));
    if (!open) throw new Error('Missing real parent entry button');
    act(() => { open.click(); });
    const originalSelect = slotSelect();
    const selected = correcting ? 2 : 1;
    choosePick(String(selected));
    expect(originalSelect.value).toBe(String(selected));
    commits.length = 0;
    await act(async () => { expect(await elsewhereCommit(['recordProvisionalPick', pick(selected, elsewhere)])).toBe(true); });

    expect(commits.length).toBeGreaterThan(0);
    expect(commits.every(choice => choice.select === originalSelect)).toBe(true);
    expect(commits.map(choice => ({ value: choice.value, disabled: choice.disabled, alert: choice.alert }))).toEqual([
      { value: '', disabled: true, alert: `Pick ${String(selected)} was just recorded elsewhere. Choose a pick.` },
    ]);
    expect(slotSelect()).toBe(originalSelect);
    expect(state().draftHistory.some(row => row.pickNumber === selected + 1)).toBe(false);
  });


  it.each([false, true])('invalidates keeper occupation in the first commit, correction=%s', async correcting => {
    if (correcting) expect(await commit(['recordProvisionalPick', pick(1, observed)])).toBe(true);
    const editingPick = correcting ? state().draftHistory[0] : undefined;
    const commits: CommittedChoice[] = [];
    const capture = (choice: CommittedChoice) => { commits.push(choice); };
    act(() => { root.render(createElement(WorkspaceProvider, { workspace,
      children: createElement(Fragment, null,
        createElement(ProvisionalPickDialog, { open: true, onOpenChange: vi.fn(), editingPick, initialPlayerId: observed.id }),
        createElement(CommitProbe, { capture, correcting })) })); });
    const originalSelect = slotSelect();
    choosePick('2');
    expect(saveButton(correcting).disabled).toBe(false);
    commits.length = 0;
    await act(async () => { await elsewhereCommit(['preloadKeepers', [{ playerId: elsewhere.id, playerName: elsewhere.name,
      position: elsewhere.position, teamIndex: 1, round: 1, isMyKeeper: false }]]); });
    expect(commits.length).toBeGreaterThan(0);
    expect(commits.every(choice => choice.select === originalSelect)).toBe(true);
    expect(commits.map(choice => ({ value: choice.value, disabled: choice.disabled, alert: choice.alert }))).toEqual([
      { value: '', disabled: true, alert: 'Pick 2 was just recorded elsewhere. Choose a pick.' },
    ]);
    expect(slotSelect()).toBe(originalSelect);
    if (correcting) expect(state().draftHistory.find(row => row.pickNumber === 1)?.playerId).toBe(observed.id);
  });

  if (enabled) it.each([false, true])('requires a new choice when another tab wins while save is pending, correction=%s', async correcting => {
    const owner = raw;
    if (!owner || !other) throw new Error('Missing durable actors');
    if (correcting) expect(await commit(['recordProvisionalPick', pick(1, observed)])).toBe(true);
    const editingPick = correcting ? state().draftHistory[0] : undefined;
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const attempts: ReturnType<typeof owner.sendDurable>[] = [];
    const saveRequests = vi.fn((command: Parameters<typeof owner.sendDurable>[0]) => {
      const attempt = gate.then(() => owner.sendDurable(command));
      attempts.push(attempt); return attempt;
    });
    try {
      workspace = { ...owner, sendDurable: saveRequests };
      const close = vi.fn();
      act(() => { root.render(createElement(WorkspaceProvider, { workspace,
        children: createElement(ProvisionalPickDialog, { open: true, onOpenChange: close, editingPick, initialPlayerId: observed.id }) })); });
      const selected = correcting ? 2 : 1;
      choosePick(String(selected));
      const submit = saveButton(correcting);
      act(() => { submit.click(); });
      expect(saveRequests).toHaveBeenCalledOnce();
      expect(saveRequests.mock.calls[0]?.[0][0]).toBe(correcting ? 'correctProvisionalPick' : 'recordProvisionalPick');
      expect(submit.textContent).toBe('Saving...');
      expect(submit.disabled).toBe(true);

      await act(async () => { expect(await elsewhereCommit(['recordProvisionalPick', pick(selected, elsewhere)])).toBe(true); });
      expect(slotSelect().value).toBe('');
      expect(submit.disabled).toBe(true);
      act(() => { submit.click(); });
      expect(saveRequests).toHaveBeenCalledOnce();
      expect(close).not.toHaveBeenCalled();
      expect(state().draftHistory.find(row => row.pickNumber === selected)?.playerId).toBe(elsewhere.id);

      await act(async () => { release(); await attempts[0]; });
      expect((await attempts[0])?.result).toBe(false);
      expect(slotSelect().value).toBe('');
      expect(saveButton(correcting).disabled).toBe(true);
      expect(document.querySelector('[role="alert"]')?.textContent).toBe(`Pick ${String(selected)} was just recorded elsewhere. Choose a pick.`);
      expect(state().draftHistory.some(row => row.pickNumber === selected + 1)).toBe(false);
      expect(state().draftHistory.find(row => row.pickNumber === selected)?.playerId).toBe(elsewhere.id);
      if (correcting) expect(state().draftHistory.find(row => row.pickNumber === 1)?.playerId).toBe(observed.id);
      expect(close).not.toHaveBeenCalled();
      act(() => { saveButton(correcting).click(); });
      expect(saveRequests).toHaveBeenCalledOnce();

      choosePick(String(selected + 1));
      await act(async () => { saveButton(correcting).click(); await attempts[1]; });
      expect(saveRequests).toHaveBeenCalledTimes(2);
      expect((await attempts[1])?.result).toBe(true);
      expect(state().draftHistory.find(row => row.pickNumber === selected + 1)?.playerId).toBe(observed.id);
      expect(close).toHaveBeenCalledWith(false);
    } finally { await act(async () => { release(); await Promise.allSettled(attempts); }); }
  });

});
