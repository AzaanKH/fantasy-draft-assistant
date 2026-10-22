// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import type { Workspace } from './workspace';
import { showStorageActivation } from './activation-entry';
import { verifyStorageSharing } from './storage-sharing';
import { initialDraftState, sessionFromState } from './draft-reducer';

async function until(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt++) await act(async () => { await new Promise<void>(resolve => { setTimeout(resolve, 5); }); });
  expect(predicate()).toBe(true);
}
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });
it('reviews changed v1 data again and allows a deliberate retry without a reload', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('crypto', webcrypto);
  const verified = await verifyStorageSharing({ canonicalOrigin: 'http://localhost:3000', location: { origin: 'http://localhost:3000', pathname: '/draft', search: '' } });
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  let mounted: Workspace | undefined;
  const ready = vi.fn((workspace: Workspace) => { mounted = workspace; });
  try {
    act(() => { showStorageActivation({ root, verified: { ...verified, origin: location.origin }, ready }); });
    await until(() => Boolean(container.querySelector('input[type="checkbox"]')));
    const identity = { provider: 'sleeper', draftId: '123' } as const;
    localStorage.setItem('fantasy-draft-session-v1:sleeper:123', JSON.stringify(sessionFromState(initialDraftState(identity), identity, 0)));
    const check = (): HTMLInputElement => { const input = container.querySelector<HTMLInputElement>('input[type="checkbox"]'); if (!input) throw new Error('Missing confirmation'); return input; };
    const activate = (): HTMLButtonElement => { const button = [...container.querySelectorAll('button')].find(button => button.textContent === 'Activate IndexedDB'); if (!button) throw new Error('Missing activation'); return button; };
    act(() => { check().click(); });
    act(() => { activate().click(); });
    await until(() => Boolean(container.querySelector('[role="alert"]')));
    expect(ready).not.toHaveBeenCalled();
    expect(container.textContent).toContain('sleeper 123');
    expect(localStorage.getItem('fantasy-draft-storage-migrated')).toBeNull();
    act(() => { check().click(); });
    act(() => { activate().click(); });
    await until(() => ready.mock.calls.length === 1);
    expect(ready).toHaveBeenCalledOnce();
    expect(localStorage.getItem('fantasy-draft-storage-migrated')).not.toBeNull();
  } finally {
    mounted?.dispose();
    act(() => { root.unmount(); }); container.remove();
  }
});
