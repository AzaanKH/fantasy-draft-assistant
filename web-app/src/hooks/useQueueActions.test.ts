import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDraftStore, DraftStoreProvider } from '@/stores/draftStore';
import { useQueueActions } from './useQueueActions';
const mocks = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('sonner', () => ({ toast: mocks.toast }));
function setup() {
  const store = createDraftStore();
  let actions!: ReturnType<typeof useQueueActions>;
  function Capture() { actions = useQueueActions([{ id: 'a', name: 'Player A' }, { id: 'b', name: 'Player B' }]); return null; }
  renderToString(createElement(DraftStoreProvider, { store, children: createElement(Capture) }));
  return { store, actions };
}
function undoLatest() {
  const options = mocks.toast.mock.calls.at(-1)?.[1] as { action: { onClick: () => void } };
  options.action.onClick();
}

describe('queue notifications and undo', () => {
  beforeEach(() => { mocks.toast.mockClear(); });
  it('undoes additions and removals while preserving other queue edits', () => {
    const { store, actions } = setup();
    actions.togglePlayerQueued('a');
    expect(mocks.toast).toHaveBeenLastCalledWith('Player A added to queue', expect.objectContaining({ id: 'queue:a' }));
    store.getState().togglePlayerShortlisted('b');
    undoLatest();
    expect(store.getState().shortlistedPlayerIds).toEqual(['b']);
    actions.removePlayerFromQueue('b');
    expect(mocks.toast).toHaveBeenLastCalledWith('Player B removed from queue', expect.objectContaining({ id: 'queue:b' }));
    undoLatest();
    expect(store.getState().shortlistedPlayerIds).toEqual(['b']);
  });
  it('updates the same player notice and ignores no-op removals', () => {
    const { store, actions } = setup();
    actions.removePlayerFromQueue('a');
    expect(mocks.toast).not.toHaveBeenCalled();
    actions.togglePlayerQueued('a');
    actions.togglePlayerQueued('a');
    expect(mocks.toast.mock.calls.map((call) => (call[1] as { id: string }).id)).toEqual(['queue:a', 'queue:a']);
    undoLatest();
    expect(store.getState().shortlistedPlayerIds).toEqual(['a']);
  });
});
