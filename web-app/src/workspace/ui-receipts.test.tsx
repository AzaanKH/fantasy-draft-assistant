// @vitest-environment jsdom
import { act, createElement, Fragment } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDraftStore } from '@/stores/draftStore';
import { createDraftSyncConnectionStore } from '@/stores/draftSyncStore';
import { ProvisionalPickDialog } from '@/features/draft-room/ProvisionalPickDialog';
import { VISUAL_PLAYERS } from '@/visual/VisualApp';
import { createWorkspace } from './workspace';
import { WorkspaceProvider } from './WorkspaceProvider';
import { observeDurableWorkspace } from './ui-dispatch';
import { CommandNotice } from './CommandNotice';

const fixture = VISUAL_PLAYERS[0];
if (!fixture) throw new Error('Missing player fixture');
vi.mock('@/hooks/usePlayerData', () => ({ usePlayerDataQuery: () => ({ players: VISUAL_PLAYERS, isLoading: false }) }));
vi.mock('@/features/draft-room/LiveDraftSyncProvider', () => ({ useLiveDraftSync: () => ({ connection: { provider: 'sleeper' } }) }));

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => { vi.unstubAllGlobals(); });

it.each(['commit', 'abort'] as const)('keeps the real pick dialog pending until durable %s', async outcome => {
  const draft = createDraftStore();
  const connection = createDraftSyncConnectionStore({ initialConnection: { provider: 'sleeper', draftId: '123', draftPosition: 1 }, persist: () => undefined });
  draft.getState().setSessionMode('live');
  let complete: ((value: { result: boolean }) => void) | undefined;
  let abort: ((error: Error) => void) | undefined;
  const receipt = new Promise<{ result: boolean }>((resolve, reject) => { complete = resolve; abort = reject; });
  const durable = vi.fn(() => receipt);
  const owner = observeDurableWorkspace(createWorkspace({ draftStore: draft, connectionStore: connection, durable }));
  draft.getState().setSessionMode('live');
  const close = vi.fn();
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  try {
    act(() => { root.render(createElement(WorkspaceProvider, { workspace: owner, children: createElement(Fragment, null,
      createElement(CommandNotice), createElement(ProvisionalPickDialog, { open: true, initialPlayerId: fixture.id, onOpenChange: close })) })); });
    const save = [...document.querySelectorAll('button')].find(button => button.textContent === 'Record Provisional Pick');
    expect(save).toBeDefined();
    act(() => { save?.click(); });
    expect(durable).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Saving');
    expect(save?.disabled).toBe(true);
    await act(async () => {
      if (outcome === 'commit') complete?.({ result: true });
      else abort?.(new Error('Quota exhausted'));
      await Promise.resolve();
    });
    if (outcome === 'commit') expect(close).toHaveBeenCalledWith(false);
    else {
      expect(close).not.toHaveBeenCalled();
      expect(document.body.textContent).toContain('Quota exhausted');
      expect(document.body.textContent).toContain('Draft change was not saved');
    }
  } finally { act(() => { root.unmount(); }); owner.dispose(); container.remove(); }
});

it('keeps later pending work visible until the prior save error is acknowledged', async () => {
  const draft = createDraftStore();
  const connection = createDraftSyncConnectionStore({ initialConnection: null, persist: () => undefined });
  let release: (() => void) | undefined;
  let calls = 0;
  const owner = observeDurableWorkspace(createWorkspace({ draftStore: draft, connectionStore: connection, durable: async () => {
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
