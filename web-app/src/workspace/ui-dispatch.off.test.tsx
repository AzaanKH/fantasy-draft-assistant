import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createStore } from 'zustand/vanilla';
import { expect, it, vi } from 'vitest';
import { createDraftStore } from '@/stores/draftStore';
import { createDraftSyncConnectionStore } from '@/stores/draftSyncStore';
import { createWorkspace } from './workspace';
import { WorkspaceProvider } from './WorkspaceProvider';
import { CommandNotice } from './CommandNotice';
import { dispatchWorkspace, requestWorkspace } from './ui-dispatch';

vi.mock('@fantasy-draft/shared/sync', async importOriginal => ({ ...await importOriginal<object>(), STORAGE_ACTIVATION_ENABLED: false }));

it('keeps OFF dispatch synchronous and hides activation status even if a durable property exists', () => {
  const workspace = createWorkspace({ draftStore: createDraftStore({ storage: null }), connectionStore: createDraftSyncConnectionStore({ initialConnection: null, persist: () => undefined }) });
  const sendDurable = vi.fn(() => { throw new Error('OFF must use v1'); });
  const owner = { ...workspace, sendDurable, status: createStore(() => ({ pending: 2, error: 'Activation save failure' })) };
  try {
    dispatchWorkspace(owner, 'togglePlayerShortlisted', 'queued');
    expect(workspace.draft.getState().shortlistedPlayerIds).toEqual(['queued']);
    const result = requestWorkspace(owner, 'reconcileSyncedPicks', [], 1, [], 100);
    expect(result).not.toBeInstanceOf(Promise);
    expect(sendDurable).not.toHaveBeenCalled();
    expect(renderToString(createElement(WorkspaceProvider, { workspace: owner, children: createElement(CommandNotice) }))).toBe('');
  } finally { workspace.dispose(); }
});
