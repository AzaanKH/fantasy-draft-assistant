import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionMessage } from '../shared/types';
import {
  createDraftRoomLifecycle,
  type DraftRoomLifecycleEnvironment,
} from './draft-room-lifecycle';

interface FakeObserver {
  readonly callback: MutationCallback;
  readonly observe: ReturnType<typeof vi.fn>;
  readonly disconnect: ReturnType<typeof vi.fn>;
}

function createHarness(initialUrl: string) {
  let url = initialUrl;
  const observers: FakeObserver[] = [];
  const intervalCallbacks: Array<() => void> = [];
  const messages: ExtensionMessage[] = [];
  const urlWatchers: Array<{ readonly onChange: () => void; stopped: boolean }> = [];
  const environment: DraftRoomLifecycleEnvironment = {
    document,
    getUrl: () => url,
    createObserver: (callback) => {
      const observer = {
        callback,
        observe: vi.fn(),
        disconnect: vi.fn(),
      };
      observers.push(observer);
      return observer;
    },
    watchUrl: (onChange) => {
      const watcher = { onChange, stopped: false };
      urlWatchers.push(watcher);
      return () => { watcher.stopped = true; };
    },
    setTimeout: (callback, delay) => window.setTimeout(callback, delay),
    clearTimeout: (timer) => {
      window.clearTimeout(timer);
    },
    setInterval: (callback, delay) => {
      intervalCallbacks.push(callback);
      return window.setInterval(callback, delay);
    },
    clearInterval: (timer) => {
      window.clearInterval(timer);
    },
    now: () => 1_000,
  };

  return {
    lifecycle: createDraftRoomLifecycle(environment, (message) => {
      messages.push(message);
    }),
    messages,
    observers,
    urlWatchers,
    intervalCallbacks,
    setUrl: (nextUrl: string) => {
      url = nextUrl;
    },
  };
}

describe('draft room lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });

  it('starts idempotently and does not create duplicate Sleeper polling', () => {
    const harness = createHarness('https://sleeper.com/draft/nfl/123');

    harness.lifecycle.start();
    harness.lifecycle.start();

    expect(
      harness.messages.filter((message) => message.type === 'DRAFT_ROOM_STATUS')
    ).toHaveLength(1);
    expect(harness.intervalCallbacks).toHaveLength(1);
    expect(harness.observers).toHaveLength(1);
    expect(harness.urlWatchers).toHaveLength(1);
  });

  it('tears down Sleeper detection when SPA navigation enters Yahoo', () => {
    const harness = createHarness('https://sleeper.com/draft/nfl/123');
    harness.lifecycle.start();
    const sleeperObserver = harness.observers[0];

    harness.setUrl(
      'https://football.fantasysports.yahoo.com/draftclient/f1/7428778/3'
    );
    harness.urlWatchers[0]?.onChange();

    expect(sleeperObserver?.disconnect).toHaveBeenCalledOnce();
    expect(harness.messages.at(-1)).toEqual({
      type: 'DRAFT_ROOM_STATUS',
      data: {
        isInDraftRoom: true,
        provider: 'yahoo',
        draftId: '7428778',
      },
    });
    expect(harness.observers).toHaveLength(1);
  });

  it('ignores URL notifications that do not change the URL', () => {
    const harness = createHarness('https://sleeper.com/draft/nfl/123');
    harness.lifecycle.start();

    harness.urlWatchers[0]?.onChange();
    harness.urlWatchers[0]?.onChange();

    expect(harness.messages.filter((message) => message.type === 'DRAFT_ROOM_STATUS')).toHaveLength(1);
    expect(harness.observers).toHaveLength(1);
  });

  it('starts Sleeper detection when SPA navigation enters a draft room and stops watching on stop', () => {
    const harness = createHarness('https://sleeper.com/leagues/1/team');
    harness.lifecycle.start();
    expect(harness.observers).toHaveLength(0);

    harness.setUrl('https://sleeper.com/draft/nfl/123');
    harness.urlWatchers[0]?.onChange();

    expect(harness.messages.at(-1)).toEqual({
      type: 'DRAFT_ROOM_STATUS',
      data: { isInDraftRoom: true, provider: 'sleeper', draftId: '123' },
    });
    expect(harness.observers).toHaveLength(1);

    harness.lifecycle.stop();
    expect(harness.urlWatchers[0]?.stopped).toBe(true);
    expect(harness.observers[0]?.disconnect).toHaveBeenCalledOnce();
  });

  it('emits a newly added Sleeper pick once across scans', () => {
    const harness = createHarness('https://sleeper.com/draft/nfl/123');
    harness.lifecycle.start();
    document.body.innerHTML =
      '<div class="player-row">CeeDee Lamb 1.4 WR - DAL</div>';

    const pickObserver = harness.observers[0];
    const addedNode = document.body.firstElementChild;
    pickObserver?.callback(
      [
        {
          addedNodes: addedNode ? [addedNode] : [],
        } as unknown as MutationRecord,
      ],
      pickObserver as unknown as MutationObserver
    );
    vi.advanceTimersByTime(5100);

    expect(
      harness.messages.filter((message) => message.type === 'PICK_DETECTED')
    ).toEqual([
      {
        type: 'PICK_DETECTED',
        data: {
          playerName: 'CeeDee Lamb',
          teamName: 'DAL',
          pickNumber: '1.4',
          position: 'WR',
          timestamp: 1_000,
        },
      },
    ]);
  });

  it('cancels a pending scan on stop, even after interval polling ran', () => {
    const harness = createHarness('https://sleeper.com/draft/nfl/123');
    harness.lifecycle.start();
    const pickObserver = harness.observers[0];
    const addedNode = document.createElement('div');
    addedNode.textContent = 'Team Alpha drafted Breece Hall';
    pickObserver?.callback(
      [{ addedNodes: [addedNode] } as unknown as MutationRecord],
      pickObserver as unknown as MutationObserver
    );

    harness.intervalCallbacks[0]?.();
    harness.lifecycle.stop();
    document.body.innerHTML = '<div class="player-row">CeeDee Lamb 1.4 WR - DAL</div>';
    vi.advanceTimersByTime(10_000);

    expect(harness.messages.filter((message) => message.type === 'PICK_DETECTED')).toEqual([]);
  });
});
