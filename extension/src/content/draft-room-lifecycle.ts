import type { DraftRoomStatus } from '../shared/types';
import type { ExtensionMessageSender } from './chrome-messenger';
import { parseDraftRoomUrl } from './draft-url';
import {
  extractPicksFromDocument,
  getPickKey,
} from './pick-parser';

interface Observer {
  observe(target: Node, options?: MutationObserverInit): void;
  disconnect(): void;
}

export interface DraftRoomLifecycleEnvironment {
  readonly document: Document;
  readonly getUrl: () => string;
  readonly createObserver: (callback: MutationCallback) => Observer;
  readonly setTimeout: (callback: () => void, delay: number) => number;
  readonly clearTimeout: (timer: number) => void;
  readonly setInterval: (callback: () => void, delay: number) => number;
  readonly clearInterval: (timer: number) => void;
  readonly now: () => number;
}

export interface DraftRoomLifecycle {
  start(): void;
  stop(): void;
}

function mutationMightContainPick(mutations: readonly MutationRecord[]): boolean {
  return mutations.some((mutation) =>
    Array.from(mutation.addedNodes).some((node) => {
      const text = node.textContent ?? '';
      return /\d+\.\d+/.test(text) || text.toLowerCase().includes('drafted');
    })
  );
}

export function createDraftRoomLifecycle(
  environment: DraftRoomLifecycleEnvironment,
  sendMessage: ExtensionMessageSender
): DraftRoomLifecycle {
  const detectedPicks = new Set<string>();
  let started = false;
  let lastUrl = '';
  let urlObserver: Observer | null = null;
  let pickObserver: Observer | null = null;
  let scanTimer: number | null = null;
  let pollTimer: number | null = null;

  const clearScanTimer = () => {
    if (scanTimer !== null) {
      environment.clearTimeout(scanTimer);
      scanTimer = null;
    }
  };

  const stopSleeperDetection = () => {
    pickObserver?.disconnect();
    pickObserver = null;
    clearScanTimer();
    if (pollTimer !== null) {
      environment.clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const scanForPicks = () => {
    const status = parseDraftRoomUrl(environment.getUrl());
    if (status.provider !== 'sleeper') {
      return;
    }

    for (const pick of extractPicksFromDocument(
      environment.document,
      environment.now()
    )) {
      const key = getPickKey(pick);
      if (detectedPicks.has(key)) {
        continue;
      }

      detectedPicks.add(key);
      sendMessage({ type: 'PICK_DETECTED', data: pick });
    }
  };

  const scheduleScan = (delay: number) => {
    clearScanTimer();
    scanTimer = environment.setTimeout(() => {
      scanTimer = null;
      scanForPicks();
    }, delay);
  };

  const startSleeperDetection = () => {
    if (pickObserver) {
      return;
    }

    pickObserver = environment.createObserver((mutations) => {
      if (mutationMightContainPick(mutations)) {
        scheduleScan(100);
      }
    });
    pickObserver.observe(environment.document.body, {
      childList: true,
      subtree: true,
    });
    scheduleScan(1000);
    pollTimer = environment.setInterval(scanForPicks, 5000);
  };

  const applyUrl = (value: string) => {
    lastUrl = value;
    detectedPicks.clear();
    stopSleeperDetection();

    const status: DraftRoomStatus = parseDraftRoomUrl(value);
    sendMessage({ type: 'DRAFT_ROOM_STATUS', data: status });

    if (status.provider === 'sleeper') {
      startSleeperDetection();
    }
  };

  const start = () => {
    if (started) {
      return;
    }

    started = true;
    applyUrl(environment.getUrl());
    urlObserver = environment.createObserver(() => {
      const currentUrl = environment.getUrl();
      if (currentUrl !== lastUrl) {
        applyUrl(currentUrl);
      }
    });
    urlObserver.observe(environment.document.body, {
      childList: true,
      subtree: true,
    });
  };

  const stop = () => {
    if (!started) {
      return;
    }

    started = false;
    urlObserver?.disconnect();
    urlObserver = null;
    stopSleeperDetection();
  };

  return { start, stop };
}
