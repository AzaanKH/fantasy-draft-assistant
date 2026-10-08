// @vitest-environment jsdom
import { act, createElement, Fragment } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Player } from '@fantasy-draft/shared';
import { createDraftStore, DraftStoreProvider, type DraftStoreApi } from '@/stores/draftStore';
import { VISUAL_PLAYERS } from '@/visual/VisualApp';

import { MockDraftControls } from './MockDraftControls';
import { MockDraftAutoAdvance } from './mock-auto-advance';

function player(index: number): Player {
  const base = VISUAL_PLAYERS[0];
  if (!base) throw new Error('Missing player fixture');
  return { ...base, id: `wr-${String(index)}`, name: `Receiver ${String(index)}`, position: 'WR', ecrRank: index };
}

const players = Array.from({ length: 40 }, (_, index) => player(index + 1));

vi.mock('@/hooks/useLeagueTimingEvidence', () => ({
  useLeagueTimingEvidence: () => ({ model: null }),
}));
vi.mock('@/hooks/usePlayerData', () => ({
  usePlayerDataQuery: () => ({ players, isLoading: false }),
}));

let container: HTMLDivElement;
let root: Root;
let store: DraftStoreApi;

// MockDraftAutoAdvance sits above the routes; the controls exist only on the draft board.
function render({ onBoard }: { readonly onBoard: boolean }): void {
  act(() => {
    root.render(createElement(DraftStoreProvider, {
      store,
      children: createElement(
        Fragment,
        null,
        createElement(MockDraftAutoAdvance),
        onBoard
          ? createElement(MockDraftControls, { players, isMockReady: true, sessionMode: 'mock' })
          : null
      ),
    }));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  store = createDraftStore();
  store.getState().setConfig({ totalTeams: 4, myPickPosition: 3 });
  store.getState().setMockSettings({ cpuPickPace: 'watch', survivalIterations: 25 });
  store.getState().setSessionMode('mock');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  vi.useRealTimers();
});

function advance(ms: number): void {
  for (let elapsed = 0; elapsed < ms; elapsed += 100) {
    act(() => { vi.advanceTimersByTime(100); });
  }
}

function draftMyPick(): void {
  const next = players.find((item) => !store.getState().draftedPlayerIds.has(item.id));
  if (!next) throw new Error('No players left');
  act(() => {
    store.getState().markPlayerDrafted(next.id, next.name, next.position, 2, 'Team 3');
  });
}

function button(label: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll('button'))
    .find((element) => element.textContent?.trim() === label);
  if (!match) throw new Error(`Missing button ${label}`);
  return match;
}

describe('mock draft auto-advance', () => {
  it('runs CPU picks to the user slot and resumes after the user drafts', () => {
    render({ onBoard: true });
    advance(3000);
    expect(store.getState().currentPick).toBe(3);

    draftMyPick();
    advance(3000);
    // Snake order: picks 4 and 5 belong to CPU teams, pick 6 to slot 3.
    expect(store.getState().currentPick).toBe(6);
    expect(store.getState().draftHistory.map((pick) => pick.source))
      .toEqual(['cpu', 'cpu', 'manual', 'cpu', 'cpu']);
  });

  it('follows linear draft order', () => {
    store.getState().setConfig({ draftType: 'linear' });
    render({ onBoard: true });
    advance(3000);
    expect(store.getState().currentPick).toBe(3);

    draftMyPick();
    advance(3000);
    // Linear order repeats round one, so slot 3 picks again at 7, not 6.
    expect(store.getState().currentPick).toBe(7);
    expect(store.getState().draftHistory.at(-1)?.teamIndex).toBe(1);
  });

  it('stays paused after the user pauses until they resume', () => {
    render({ onBoard: true });
    act(() => { button('Pause').click(); });
    advance(3000);
    expect(store.getState().currentPick).toBe(1);

    act(() => { button('CPU pick').click(); });
    expect(store.getState().currentPick).toBe(2);

    act(() => { button('Resume').click(); });
    advance(3000);
    expect(store.getState().currentPick).toBe(3);
  });

  it('does not run CPU picks while the settings dialog is open', () => {
    render({ onBoard: true });
    act(() => { button('Settings').click(); });
    advance(3000);
    expect(store.getState().currentPick).toBe(1);
  });

  it('does not branch past the current pick', () => {
    render({ onBoard: true });
    advance(3000);
    expect(store.getState().currentPick).toBe(3);

    act(() => { button('Settings').click(); });
    const input = Array.from(document.body.querySelectorAll('label'))
      .find((label) => label.textContent?.includes('Branch at overall pick'))
      ?.querySelector('input');
    if (!input) throw new Error('Missing branch input');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '96');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const create = Array.from(document.body.querySelectorAll('button'))
      .find((element) => element.textContent?.trim() === 'Create branch');
    act(() => { create?.click(); });
    expect(store.getState().currentPick).toBe(3);
    expect(store.getState().draftHistory).toHaveLength(2);
  });

  it('keeps the pause when the user leaves the draft board', () => {
    render({ onBoard: true });
    act(() => { button('Pause').click(); });
    render({ onBoard: false });
    render({ onBoard: true });
    advance(3000);
    expect(store.getState().currentPick).toBe(1);
  });

  it('continues after a pick made away from the draft board', () => {
    render({ onBoard: false });
    advance(3000);
    expect(store.getState().currentPick).toBe(3);

    draftMyPick();
    advance(3000);
    expect(store.getState().currentPick).toBe(6);
  });

  it('holds an undone keeper slot until the user resumes', () => {
    store.getState().preloadKeepers([{
      playerId: 'keeper-1', playerName: 'Keeper', position: 'RB', teamIndex: 0, round: 1, isMyKeeper: false,
    }]);
    render({ onBoard: true });
    advance(3000);
    expect(store.getState().draftHistory.map((pick) => pick.source)).toEqual(['keeper', 'cpu']);

    act(() => {
      store.getState().undoLastPick();
      store.getState().undoLastPick();
    });
    advance(3000);
    expect(store.getState().currentPick).toBe(1);
    expect(store.getState().draftHistory).toEqual([]);

    act(() => { button('Resume').click(); });
    advance(3000);
    expect(store.getState().currentPick).toBe(3);
  });

  it('holds keeper slots while the settings dialog is open', () => {
    store.getState().preloadKeepers([{
      playerId: 'keeper-1', playerName: 'Keeper', position: 'RB', teamIndex: 0, round: 1, isMyKeeper: false,
    }]);
    render({ onBoard: true });
    act(() => { button('Settings').click(); });
    advance(3000);
    expect(store.getState().draftHistory).toEqual([]);
  });
});
