// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { createDraftStore } from '@/stores/draftStore';
import { VISUAL_PLAYERS } from '@/visual/VisualApp';
import { WorkspaceProvider } from '@/workspace/WorkspaceProvider';
import { workspaceForTestStore } from '@/workspace/workspace-test-helpers';
import { useDraftPlayerAction } from './useDraftPlayerAction';

const save = vi.hoisted(() => ({ result: Promise.resolve() as Promise<unknown> }));
// Both writers (durable and v1) report through the same promise here, whichever the build selects.
vi.mock('@/workspace/workspace-command', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/workspace/workspace-command')>(),
  commitWorkspaceCommand: () => save.result,
}));
vi.mock('@/hooks/usePlayerData', () => ({ usePlayerDataQuery: () => ({ players: VISUAL_PLAYERS, isLoading: false }) }));

afterEach(() => { vi.unstubAllGlobals(); });

it('shows pending on the triggering player, then a failure with its reason, and clears on a successful retry', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const store = createDraftStore();
  store.getState().setConfig({ totalTeams: 4, totalRounds: 3, myPickPosition: 1, draftType: 'snake' });
  store.getState().setSessionMode('mock');
  const workspace = { ...workspaceForTestStore(store), sendDurable: () => save.result };
  let actions: ReturnType<typeof useDraftPlayerAction> | undefined;
  function Consumer() { actions = useDraftPlayerAction(); return null; }
  const root = createRoot(document.createElement('div'));
  act(() => { root.render(createElement(WorkspaceProvider, { workspace, children: createElement(Consumer) })); });
  const [player] = VISUAL_PLAYERS;
  if (!player) throw new Error('Missing player');

  let reject: (error: Error) => void = () => undefined;
  save.result = new Promise((_, fail) => { reject = fail; });
  act(() => { actions?.draftPlayer(player); });
  expect(actions?.draftStatus).toEqual({ playerId: player.id, state: 'pending' });

  await act(async () => { reject(new Error('Storage is full.')); await Promise.resolve(); });
  expect(actions?.draftStatus).toEqual({ playerId: player.id, state: 'failed', message: `${player.name} was not drafted. Storage is full.` });

  save.result = Promise.resolve();
  await act(async () => { actions?.draftPlayer(player); await Promise.resolve(); });
  expect(actions?.draftStatus).toBeNull();
  act(() => { root.unmount(); });
});

it('shares one pick lock: a second control cannot draft while the first save is pending, and only the first shows the failure', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const store = createDraftStore();
  store.getState().setConfig({ totalTeams: 4, totalRounds: 3, myPickPosition: 1, draftType: 'snake' });
  store.getState().setSessionMode('mock');
  const dismissError = vi.fn();
  const sendDurable = vi.fn(() => save.result);
  const workspace = { ...workspaceForTestStore(store), sendDurable, dismissError };
  let pool: ReturnType<typeof useDraftPlayerAction> | undefined;
  let card: ReturnType<typeof useDraftPlayerAction> | undefined;
  function Pool() { pool = useDraftPlayerAction(); return null; }
  function Card() { card = useDraftPlayerAction(); return null; }
  const root = createRoot(document.createElement('div'));
  act(() => { root.render(createElement(WorkspaceProvider, { workspace, children: [createElement(Pool, { key: 'pool' }), createElement(Card, { key: 'card' })] })); });
  const [player, other] = VISUAL_PLAYERS;
  if (!player || !other) throw new Error('Missing players');

  let reject: (error: Error) => void = () => undefined;
  save.result = new Promise((_, fail) => { reject = fail; });
  act(() => { pool?.draftPlayer(player); });
  expect(pool?.pickInFlight).toBe(true);
  expect(card?.pickInFlight).toBe(true);
  expect(card?.draftStatus).toBeNull();

  act(() => { card?.draftPlayer(other); });
  // Only the first pick reached the writer (whichever one this build uses).
  expect(card?.draftStatus).toBeNull();
  expect(pool?.draftStatus).toEqual({ playerId: player.id, state: 'pending' });

  await act(async () => { reject(new Error('Storage is full.')); await Promise.resolve(); });
  expect(pool?.pickInFlight).toBe(false);
  expect(pool?.draftStatus?.state).toBe('failed');
  expect(card?.draftStatus).toBeNull();
  expect(dismissError).toHaveBeenCalledOnce();
  act(() => { root.unmount(); });
});
