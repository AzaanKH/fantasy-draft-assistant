// @vitest-environment jsdom
import { act, createElement, Fragment, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Player } from '@fantasy-draft/shared/league';
import { createDraftStore, type DraftStoreApi } from '@/stores/draftStore';
import { WorkspaceTestProvider } from '@/workspace/workspace-test-helpers';
import { VISUAL_PLAYERS } from '@/visual/VisualApp';
import { ProvisionalPickDialog } from './ProvisionalPickDialog';
import { ManualContinuityControl } from './ManualContinuityControl';
import { useDraftState } from '@/workspace/WorkspaceProvider';

const [observed, elsewhere] = VISUAL_PLAYERS;
if (!observed || !elsewhere) throw new Error('Missing player fixtures');
vi.mock('@/hooks/usePlayerData', () => ({ usePlayerDataQuery: () => ({ players: VISUAL_PLAYERS, isLoading: false }) }));
vi.mock('./LiveDraftSyncProvider', () => ({ useLiveDraftSync: () => ({ connection: { provider: 'sleeper' }, canEnterManualContinuity: true,
  synchronizationState: 'manual-continuity', lastConfirmedPickNumber: 0, provisionalPickCount: 0,
  viewState: { connectionState: 'connected' } }) }));

let store: DraftStoreApi;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  store = createDraftStore();
  store.getState().setConfig({ totalTeams: 4, totalRounds: 3, myPickPosition: 1, draftType: 'linear' });
  store.getState().setSessionMode('live');
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => {
  act(() => { root.unmount(); });
  store.dispose(); container.remove(); vi.unstubAllGlobals();
});

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

it.each([false, true])('requires an explicit new choice when another writer occupies the selected pick, correction=%s', async correcting => {
  if (correcting) expect(store.getState().recordProvisionalPick(pick(1, observed))).toBe(true);
  const editingPick = correcting ? store.getState().draftHistory[0] : undefined;
  const close = vi.fn();
  act(() => { root.render(createElement(WorkspaceTestProvider, { store,
    children: createElement(ProvisionalPickDialog, { open: true, onOpenChange: close, editingPick,
      initialPlayerId: observed.id }) })); });
  const selected = correcting ? 2 : 1;
  choosePick(String(selected));
  expect(slotSelect().value).toBe(String(selected));
  expect(saveButton(correcting).disabled).toBe(false);

  // The real store update is the same subscription notification another writer supplies.
  act(() => { expect(store.getState().recordProvisionalPick(pick(selected, elsewhere))).toBe(true); });
  await act(async () => { saveButton(correcting).click(); });

  expect(store.getState().draftHistory.some(row => row.pickNumber === selected + 1)).toBe(false);
  expect(close).not.toHaveBeenCalled();
  expect(slotSelect().value).toBe('');
  expect(saveButton(correcting).disabled).toBe(true);
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(`Pick ${String(selected)} was just recorded elsewhere. Choose a pick.`);
  if (correcting) expect(store.getState().draftHistory.find(row => row.pickNumber === 1)?.playerId).toBe(observed.id);

  // Unrelated updates cannot implicitly choose a replacement position either.
  act(() => { store.getState().setSearchQuery('another render'); });
  expect(slotSelect().value).toBe('');
  choosePick(String(selected + 1));
  expect(saveButton(correcting).disabled).toBe(false);
  expect(document.querySelector('[role="alert"]')).toBeNull();
  await act(async () => { saveButton(correcting).click(); });
  expect(store.getState().draftHistory.find(row => row.pickNumber === selected + 1)?.playerId).toBe(observed.id);
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

it.each([false, true])('invalidates the real parent-opened control in the first commit without remounting, correction=%s', correcting => {
  if (correcting) expect(store.getState().recordProvisionalPick(pick(1, observed))).toBe(true);
  const commits: CommittedChoice[] = [];
  const capture = (choice: CommittedChoice) => { commits.push(choice); };
  act(() => { root.render(createElement(WorkspaceTestProvider, { store,
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
  act(() => { expect(store.getState().recordProvisionalPick(pick(selected, elsewhere))).toBe(true); });

  expect(commits.length).toBeGreaterThan(0);
  expect(commits.every(choice => choice.select === originalSelect)).toBe(true);
  expect(commits.map(choice => ({ value: choice.value, disabled: choice.disabled, alert: choice.alert }))).toEqual([
    { value: '', disabled: true, alert: `Pick ${String(selected)} was just recorded elsewhere. Choose a pick.` },
  ]);
  expect(slotSelect()).toBe(originalSelect);
  expect(store.getState().draftHistory.some(row => row.pickNumber === selected + 1)).toBe(false);
});


it.each([false, true])('invalidates keeper occupation in the first commit, correction=%s', correcting => {
  if (correcting) expect(store.getState().recordProvisionalPick(pick(1, observed))).toBe(true);
  const editingPick = correcting ? store.getState().draftHistory[0] : undefined;
  const commits: CommittedChoice[] = [];
  const capture = (choice: CommittedChoice) => { commits.push(choice); };
  act(() => { root.render(createElement(WorkspaceTestProvider, { store,
    children: createElement(Fragment, null,
      createElement(ProvisionalPickDialog, { open: true, onOpenChange: vi.fn(), editingPick, initialPlayerId: observed.id }),
      createElement(CommitProbe, { capture, correcting })) })); });
  const originalSelect = slotSelect();
  choosePick('2');
  expect(saveButton(correcting).disabled).toBe(false);
  commits.length = 0;
  act(() => { store.getState().preloadKeepers([{ playerId: elsewhere.id, playerName: elsewhere.name,
    position: elsewhere.position, teamIndex: 1, round: 1, isMyKeeper: false }]); });
  expect(commits.length).toBeGreaterThan(0);
  expect(commits.every(choice => choice.select === originalSelect)).toBe(true);
  expect(commits.map(choice => ({ value: choice.value, disabled: choice.disabled, alert: choice.alert }))).toEqual([
    { value: '', disabled: true, alert: 'Pick 2 was just recorded elsewhere. Choose a pick.' },
  ]);
  expect(slotSelect()).toBe(originalSelect);
  if (correcting) expect(store.getState().draftHistory.find(row => row.pickNumber === 1)?.playerId).toBe(observed.id);
});
