// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';
import { createDraftStore } from '@/stores/draftStore';
import { createWorkspace } from '@/workspace/workspace';
import { createDurableWorkspace } from '@/workspace/durable-workspace';
import { openDraftDatabase } from '@/workspace/indexed-db';
import { decodeIndexedSession } from '@/workspace/idb-session';
import { resolveInitialConnection } from '@/workspace/connection-hints';
import { WorkspaceProvider } from '@/workspace/WorkspaceProvider';
import { SidePanelSlotControl } from './SidePanelSlotControl';

vi.mock('@fantasy-draft/shared/sync', async original => ({ ...await original<object>(), STORAGE_ACTIVATION_ENABLED: true }));
afterEach(() => { vi.unstubAllGlobals(); });

it.each(['v1', 'idb'] as const)('a new sidepanel draft can confirm its slot through the %s owner after a foreign URL hint is ignored', async mode => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const initialConnection = resolveInitialConnection('?provider=espn&draftId=456&position=5', { provider: 'sleeper', draftId: '123', draftPosition: 8 });
  const workspace = mode === 'v1' ? createWorkspace({ draftStore: createDraftStore(), initialConnection })
    : createDurableWorkspace({ database: await openDraftDatabase({ factory: new IDBFactory(), decode: decodeIndexedSession, report: () => {} }), search: '', initialConnection });
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  try {
    if (workspace.sendDurable) await workspace.sendDurable(['setSearchQuery', 'initialized']);
    expect(workspace.connection.getState().connection?.draftPosition).toBeNull();
    await act(async () => { root.render(createElement(WorkspaceProvider, { workspace, children: createElement(SidePanelSlotControl) })); });
    const select = container.querySelector('select');
    expect(select).not.toBeNull();
    await act(async () => {
      if (!select) throw new Error('Side panel cannot confirm its slot');
      select.value = '5'; select.dispatchEvent(new Event('change', { bubbles: true }));
      if (workspace.sendDurable) await workspace.sendDurable(['setSearchQuery', 'drained']);
    });
    expect(workspace.connection.getState().connection).toMatchObject({ provider: 'espn', draftId: '456', draftPosition: 5 });
    expect(workspace.draft.getState().sessionMode).toBe('live');
    expect(container.querySelector('select')).toBeNull();
  } finally { act(() => { root.unmount(); }); container.remove(); workspace.dispose(); }
});
