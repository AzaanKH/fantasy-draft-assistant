// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Player } from '@fantasy-draft/shared';
import { createDraftStore, DraftStoreProvider, type DraftStoreApi } from '@/stores/draftStore';
import { VISUAL_PLAYERS } from '@/visual/VisualApp';

import { MockDraftControls } from './MockDraftControls';

vi.mock('@/hooks/useLeagueTimingEvidence', () => ({
  useLeagueTimingEvidence: () => ({ model: null }),
}));

function player(index: number): Player {
  const base = VISUAL_PLAYERS[0];
  if (!base) throw new Error('Missing player fixture');
  return { ...base, id: `wr-${String(index)}`, name: `Receiver ${String(index)}`, position: 'WR', ecrRank: index };
}

const players = Array.from({ length: 40 }, (_, index) => player(index + 1));

let container: HTMLDivElement;
let root: Root;
let store: DraftStoreApi;

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
  act(() => {
    root.render(createElement(DraftStoreProvider, {
      store,
      children: createElement(MockDraftControls, { players, isMockReady: true, sessionMode: 'mock' }),
    }));
  });
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

describe('MockDraftControls auto-advance', () => {
  it('runs CPU picks to the user slot and resumes after the user drafts', () => {
    advance(3000);
    expect(store.getState().currentPick).toBe(3);

    draftMyPick();
    advance(3000);
    // Snake order: picks 4 and 5 belong to CPU teams, pick 6 to slot 3.
    expect(store.getState().currentPick).toBe(6);
    expect(store.getState().draftHistory.map((pick) => pick.source))
      .toEqual(['cpu', 'cpu', 'manual', 'cpu', 'cpu']);
  });

  it('stays paused after the user pauses until they resume', () => {
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
    act(() => { button('Settings').click(); });
    advance(3000);
    expect(store.getState().currentPick).toBe(1);
  });
});
