// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDraftStore } from '@/stores/draftStore';
import { createWorkspace } from '@/workspace/workspace';
import { WorkspaceProvider } from '@/workspace/WorkspaceProvider';
import { observeDurableWorkspace } from '@/workspace/ui-dispatch';
import { LeagueSetupDialog } from './LeagueSetupDialog';

const toast = vi.hoisted(() => ({ success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@fantasy-draft/shared/sync', async importOriginal => ({ ...await importOriginal<object>(), STORAGE_ACTIVATION_ENABLED: true }));
vi.mock('@/lib/demo-mode', async importOriginal => ({ ...await importOriginal<object>(), IS_DEMO: false }));

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  toast.success.mockReset();
});
afterEach(() => { vi.unstubAllGlobals(); });

it.each(['commit', 'abort'] as const)('waits for the durable settings save before announcing success, outcome=%s', async outcome => {
  let complete: (() => void) | undefined;
  let abort: ((error: Error) => void) | undefined;
  const receipt = new Promise<void>((resolve, reject) => { complete = resolve; abort = reject; });
  const durable = vi.fn(() => receipt);
  const owner = observeDurableWorkspace(createWorkspace({ draftStore: createDraftStore({ storage: null }),
    initialConnection: { provider: 'sleeper', draftId: '123', draftPosition: 1 }, durable }));
  const close = vi.fn();
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  try {
    act(() => { root.render(createElement(WorkspaceProvider, { workspace: owner,
      children: createElement(LeagueSetupDialog, { open: true, onOpenChange: close, onConnectPrimary: vi.fn() }) })); });
    const apply = [...document.querySelectorAll('button')].find(button => button.textContent === 'Use Primary League practice settings');
    if (!apply) throw new Error('Missing apply button');
    act(() => { apply.click(); });

    expect(durable).toHaveBeenCalledWith(['connection.setPrimaryLeagueSettings', true]);
    expect(apply.textContent).toBe('Saving settings...');
    expect(apply.disabled).toBe(true);
    expect(toast.success).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();

    await act(async () => {
      if (outcome === 'commit') complete?.();
      else abort?.(new Error('Quota exhausted'));
      await receipt.catch(() => undefined);
    });

    if (outcome === 'commit') {
      expect(toast.success).toHaveBeenCalledOnce();
      expect(close).toHaveBeenCalledWith(false);
    } else {
      expect(toast.success).not.toHaveBeenCalled();
      expect(close).not.toHaveBeenCalled();
      expect(document.querySelector('[role="alert"]')?.textContent).toBe('League settings were not saved. Quota exhausted');
      expect(apply.disabled).toBe(false);
    }
  } finally { act(() => { root.unmount(); }); owner.dispose(); container.remove(); }
});
