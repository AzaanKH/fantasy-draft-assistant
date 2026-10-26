// @vitest-environment jsdom
import { act, createElement, Fragment } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Player } from '@fantasy-draft/shared/league';
import { createDraftStore } from '@/stores/draftStore';
import { ProvisionalPickDialog } from '@/features/draft-room/ProvisionalPickDialog';
import { VISUAL_PLAYERS } from '@/visual/VisualApp';
import { createWorkspace } from './workspace';
import { WorkspaceProvider } from './WorkspaceProvider';
import { observeDurableWorkspace } from './ui-dispatch';
import { CommandNotice } from './CommandNotice';

const [fixture, elsewhere] = VISUAL_PLAYERS;
if (!fixture || !elsewhere) throw new Error('Missing player fixture');
vi.mock('@fantasy-draft/shared/sync', async importOriginal => ({ ...await importOriginal<object>(), STORAGE_ACTIVATION_ENABLED: true }));
vi.mock('@/hooks/usePlayerData', () => ({ usePlayerDataQuery: () => ({ players: VISUAL_PLAYERS, isLoading: false }) }));
vi.mock('@/features/draft-room/LiveDraftSyncProvider', () => ({ useLiveDraftSync: () => ({ connection: { provider: 'sleeper' } }) }));

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => { vi.unstubAllGlobals(); });

function pick(pickNumber: number, player: Player) {
  return { pickNumber, playerId: player.id, playerName: player.name, position: player.position,
    teamIndex: pickNumber - 1, teamName: pickNumber === 1 ? 'My Team' : `Team ${String(pickNumber)}` };
}
function choosePick(value: string): HTMLSelectElement {
  const select = document.querySelector<HTMLSelectElement>('select[aria-label="Team and draft position"]');
  if (!select) throw new Error('Missing pick selector');
  act(() => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); });
  return select;
}

it.each([false, true].flatMap(correcting => (['commit', 'abort'] as const).map(outcome => ({ correcting, outcome }))))('keeps the real pick dialog pending until durable $outcome, correction=$correcting', async ({ outcome, correcting }) => {
  const draft = createDraftStore();
  draft.getState().setSessionMode('live');
  let complete: ((value: { result: boolean }) => void) | undefined;
  let abort: ((error: Error) => void) | undefined;
  const receipt = new Promise<{ result: boolean }>((resolve, reject) => { complete = resolve; abort = reject; });
  const durable = vi.fn(() => receipt);
  const owner = observeDurableWorkspace(createWorkspace({ draftStore: draft, initialConnection: { provider: 'sleeper', draftId: '123', draftPosition: 1 }, durable }));
  draft.getState().setSessionMode('live');
  draft.getState().setConfig({ totalTeams: 4, totalRounds: 3, myPickPosition: 1, draftType: 'linear' });
  if (correcting) expect(draft.getState().recordProvisionalPick(pick(1, fixture))).toBe(true);
  const editingPick = correcting ? draft.getState().draftHistory[0] : undefined;
  const send = vi.spyOn(owner, 'send');
  const close = vi.fn();
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  try {
    act(() => { root.render(createElement(WorkspaceProvider, { workspace: owner, children: createElement(Fragment, null,
      createElement(CommandNotice), createElement(ProvisionalPickDialog, { open: true, initialPlayerId: fixture.id, onOpenChange: close, editingPick })) })); });
    choosePick(correcting ? '2' : '1');
    const save = [...document.querySelectorAll('button')].find(button => button.textContent === (correcting ? 'Save Correction' : 'Record Provisional Pick'));
    expect(save).toBeDefined();
    act(() => { save?.click(); });
    expect(durable).toHaveBeenCalledOnce();
    expect(durable).toHaveBeenCalledWith(correcting ? ['correctProvisionalPick', 1, pick(2, fixture)] : ['recordProvisionalPick', pick(1, fixture)]);
    expect(send).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Saving');
    expect(save?.disabled).toBe(true);
    act(() => { save?.click(); });
    expect(durable).toHaveBeenCalledOnce();
    await act(async () => {
      if (outcome === 'commit') complete?.({ result: true });
      else abort?.(new Error('Quota exhausted'));
      await Promise.resolve();
    });
    expect(send).not.toHaveBeenCalled();
    if (outcome === 'commit') { expect(close).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledWith(false); }
    else {
      expect(close).not.toHaveBeenCalled();
      expect(document.body.textContent).toContain('Quota exhausted');
      expect(document.body.textContent).toContain('Draft change was not saved');
    }
  } finally { act(() => { root.unmount(); }); owner.dispose(); container.remove(); }
});

it.each([false, true].flatMap(correcting => [false, true].map(accepted => ({ correcting, accepted }))))('waits for the receipt after publication and requires reselection on conflict, correction=$correcting accepted=$accepted', async ({ correcting, accepted }) => {
  const draft = createDraftStore();
  let resolveReceipt: (value: { result: boolean }) => void = () => { throw new Error('Receipt not initialized'); };
  const receipt = new Promise<{ result: boolean }>(resolve => { resolveReceipt = resolve; });
  const durable = vi.fn(() => receipt);
  const owner = observeDurableWorkspace(createWorkspace({ draftStore: draft, initialConnection: { provider: 'sleeper', draftId: '123', draftPosition: 1 }, durable }));
  draft.getState().setSessionMode('live');
  draft.getState().setConfig({ totalTeams: 4, totalRounds: 3, myPickPosition: 1, draftType: 'linear' });
  if (correcting) expect(draft.getState().recordProvisionalPick(pick(1, fixture))).toBe(true);
  const editingPick = correcting ? draft.getState().draftHistory[0] : undefined;
  const send = vi.spyOn(owner, 'send');
  const close = vi.fn();
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const target = 2;
  try {
    act(() => { root.render(createElement(WorkspaceProvider, { workspace: owner,
      children: createElement(ProvisionalPickDialog, { open: true, initialPlayerId: fixture.id, editingPick, onOpenChange: close }) })); });
    const select = choosePick(String(target));
    const save = [...document.querySelectorAll('button')].find(button => button.textContent === (correcting ? 'Save Correction' : 'Record Provisional Pick'));
    if (!save) throw new Error('Missing save button');
    act(() => { save.click(); });
    expect(durable).toHaveBeenCalledWith(correcting ? ['correctProvisionalPick', 1, pick(target, fixture)] : ['recordProvisionalPick', pick(target, fixture)]);
    act(() => {
      if (accepted && correcting) expect(draft.getState().correctProvisionalPick(1, pick(target, fixture))).toBe(true);
      else expect(draft.getState().recordProvisionalPick(pick(target, accepted ? fixture : elsewhere))).toBe(true);
    });
    expect(document.body.textContent).toContain('Saving...');
    expect(save.disabled).toBe(true);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(close).not.toHaveBeenCalled();
    act(() => { save.click(); });
    expect(durable).toHaveBeenCalledOnce();
    await act(async () => { resolveReceipt({ result: accepted }); await receipt; });
    expect(durable).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
    if (accepted) {
      expect(close).toHaveBeenCalledOnce();
      expect(close).toHaveBeenCalledWith(false);
    } else {
      expect(close).not.toHaveBeenCalled();
      expect(select.value).toBe('');
      expect(save.disabled).toBe(true);
      expect(document.querySelector('[role="alert"]')?.textContent).toBe('Pick 2 was just recorded elsewhere. Choose a pick.');
      if (correcting) expect(draft.getState().draftHistory.find(row => row.pickNumber === 1)?.playerId).toBe(fixture.id);
      act(() => { draft.getState().setSearchQuery('unrelated'); });
      expect(select.value).toBe('');
      expect(save.disabled).toBe(true);
      choosePick('3');
      expect(save.disabled).toBe(false);
      expect(document.querySelector('[role="alert"]')).toBeNull();
      expect(durable).toHaveBeenCalledOnce();
    }
  } finally { act(() => { root.unmount(); }); owner.dispose(); container.remove(); }
});

it('keeps later pending work visible until the prior save error is acknowledged', async () => {
  const draft = createDraftStore();
  let release: (() => void) | undefined;
  let calls = 0;
  const owner = observeDurableWorkspace(createWorkspace({ draftStore: draft, durable: async () => {
    if (calls++ === 0) throw new Error('First write aborted');
    await new Promise<void>(resolve => { release = resolve; }); return { result: undefined };
  } }));
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  try {
    act(() => { root.render(createElement(WorkspaceProvider, { workspace: owner, children: createElement(CommandNotice) })); });
    await act(async () => { await owner.sendDurable?.(['setSearchQuery', 'first']).catch(() => undefined); });
    let pending: Promise<unknown> | undefined;
    act(() => { pending = owner.sendDurable?.(['setSearchQuery', 'second']); });
    expect(container.textContent).toContain('First write aborted');
    expect(container.textContent).toContain('Saving 1 draft change');
    const dismiss = [...container.querySelectorAll('button')].find(button => button.textContent === 'Dismiss save error');
    act(() => { dismiss?.click(); });
    expect(container.textContent).not.toContain('First write aborted');
    expect(container.textContent).toContain('Saving 1 draft change');
    await act(async () => { release?.(); await pending; });
    expect(container.textContent).toBe('');
  } finally { act(() => { root.unmount(); }); owner.dispose(); container.remove(); }
});
