// @vitest-environment jsdom
import { act, createElement, type EffectCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { createDraftStore } from '@/stores/draftStore';
import { createWorkspace } from '@/workspace/workspace';
import { WorkspaceProvider } from '@/workspace/WorkspaceProvider';
import { VISUAL_PLAYERS } from '@/visual/VisualApp';
import type { DraftSyncSnapshot } from '@fantasy-draft/shared/sync';
import { useDraftSyncReconciliation } from './useDraftSyncReconciliation';

const effects = vi.hoisted(() => [] as EffectCallback[]);
// Drive the failed effect again without remounting its refs, as an effect retry does.
vi.mock('react', async importOriginal => ({ ...await importOriginal<object>(), useEffect: (effect: EffectCallback) => { effects.push(effect); } }));
vi.mock('@fantasy-draft/shared/sync', async importOriginal => ({ ...await importOriginal<object>(), STORAGE_ACTIVATION_ENABLED: false }));
vi.mock('@/hooks/usePlayerData', () => ({ usePlayerDataQuery: () => ({ players: VISUAL_PLAYERS, isLoading: false }) }));
afterEach(() => { vi.unstubAllGlobals(); effects.length = 0; });

it('retries the same OFF reconciliation after a synchronous dispatch failure', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const draftStore = createDraftStore({ storage: null });
  const workspace = createWorkspace({ draftStore });
  const send = vi.spyOn(workspace, 'send').mockImplementationOnce(() => { throw new Error('Synchronous save failure'); });
  const snapshot: DraftSyncSnapshot = { provider: 'sleeper', draftId: '123', status: 'synced', draft: null, picks: [], lastSuccessfulSyncAt: 100, lastPolledAt: 100, lastError: null };
  function Consumer() { useDraftSyncReconciliation('sleeper', '123', snapshot, true); return null; }
  const root = createRoot(document.createElement('div'));
  try {
    act(() => { root.render(createElement(WorkspaceProvider, { workspace, children: createElement(Consumer) })); });
    const reconcile = effects.at(-1);
    if (!reconcile) throw new Error('Missing reconciliation effect');
    expect(() => { act(() => { reconcile(); }); }).toThrow('Synchronous save failure');
    act(() => { reconcile(); });
    expect(send).toHaveBeenCalledTimes(2);
  } finally { act(() => { root.unmount(); }); workspace.dispose(); }
});
