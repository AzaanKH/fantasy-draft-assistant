import {
  buildEspnDraftSnapshot,
  getEspnDraftFrameCommand,
} from './espn-draft-snapshot';

type UnknownRecord = Record<string, unknown>;

const ESPN_BRIDGE_SOURCE = 'fantasy-draft-assistant:espn';
const ESPN_BRIDGE_VERSION = 1;
const PATCH_MARKER = '__fantasyDraftAssistantEspnBridge';
const ESPN_DRAFT_HOST = 'fantasydraft.espn.com';
const SENSITIVE_PROPERTY = /token|auth|cookie|credential|member|owner|profile|security|swid/i;
const FIBER_LINKS = new Set([
  'alternate',
  'child',
  'return',
  'sibling',
  'stateNode',
  '_owner',
  'context',
  'ref',
  'updater',
]);

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null
    ? (value as UnknownRecord)
    : null;
}

function read(record: UnknownRecord | null, key: string): unknown {
  if (!record) return undefined;
  try {
    return record[key];
  } catch {
    return undefined;
  }
}

function isEspnDraftEndpoint(value: string | URL): boolean {
  try {
    return new URL(String(value), window.location.href).hostname === ESPN_DRAFT_HOST;
  } catch {
    return false;
  }
}

function findReactRootFiber(): UnknownRecord | null {
  const root = document.getElementById('__next');
  if (!root) return null;
  const key = Object.getOwnPropertyNames(root).find(
    (property) =>
      property.startsWith('__reactContainer') || property.startsWith('__reactFiber')
  );
  return key ? asRecord((root as unknown as UnknownRecord)[key]) : null;
}

function findDraftStore(): UnknownRecord | null {
  const rootFiber = findReactRootFiber();
  if (!rootFiber) return null;

  const fiberQueue: UnknownRecord[] = [rootFiber];
  const fibers: UnknownRecord[] = [];
  const seenFibers = new WeakSet();
  while (fiberQueue.length > 0 && fibers.length < 20_000) {
    const fiber = fiberQueue.shift();
    if (!fiber || seenFibers.has(fiber)) continue;
    seenFibers.add(fiber);
    fibers.push(fiber);
    const child = asRecord(read(fiber, 'child'));
    const sibling = asRecord(read(fiber, 'sibling'));
    if (child) fiberQueue.push(child);
    if (sibling) fiberQueue.push(sibling);
  }

  const objectQueue: unknown[] = [];
  for (const fiber of fibers) {
    objectQueue.push(read(fiber, 'memoizedProps'), read(fiber, 'memoizedState'));
    const stateNode = read(fiber, 'stateNode');
    if (stateNode && !(stateNode instanceof Node)) objectQueue.push(stateNode);
  }

  const seenObjects = new WeakSet();
  let inspected = 0;
  while (objectQueue.length > 0 && inspected < 50_000) {
    const candidate = objectQueue.shift();
    if (
      (typeof candidate !== 'object' && typeof candidate !== 'function') ||
      candidate === null ||
      candidate instanceof Node ||
      seenObjects.has(candidate)
    ) {
      continue;
    }
    seenObjects.add(candidate);
    inspected += 1;

    const record = candidate as UnknownRecord;
    const picks = read(record, 'picks');
    if (
      Array.isArray(picks) &&
      read(record, 'leagueId') !== undefined &&
      read(record, 'draftType') !== undefined
    ) {
      return record;
    }

    let keys: string[];
    try {
      keys = Object.keys(record).slice(0, 160);
    } catch {
      continue;
    }

    for (const key of keys) {
      if (FIBER_LINKS.has(key) || SENSITIVE_PROPERTY.test(key)) continue;
      const child = read(record, key);
      if (
        child === null ||
        (typeof child !== 'object' && typeof child !== 'function') ||
        child instanceof Node ||
        seenObjects.has(child)
      ) {
        continue;
      }
      if (key === 'draft' || key === 'store' || key === 'page') {
        objectQueue.unshift(child);
      } else {
        objectQueue.push(child);
      }
    }
  }
  return null;
}

async function readMessageData(value: unknown): Promise<string | null> {
  if (typeof value === 'string') return value;
  if (value instanceof Blob) return value.text();
  if (value instanceof ArrayBuffer) return new TextDecoder().decode(value);
  if (ArrayBuffer.isView(value)) return new TextDecoder().decode(value);
  return null;
}

function installBridge(): void {
  const markedWindow = window as unknown as UnknownRecord;
  if (markedWindow[PATCH_MARKER] === true) return;
  markedWindow[PATCH_MARKER] = true;

  let draftStore: UnknownRecord | null = null;
  let draftStoreDiscoveredAt: number | null = null;
  let lastSignature = '';
  let lastSnapshotEmittedAt = 0;
  let pendingTimer: number | null = null;
  let discoveryAttempts = 0;
  const snapshotHeartbeatMs = 10_000;

  const emitSnapshot = () => {
    pendingTimer = null;
    if (!draftStore) {
      draftStore = findDraftStore();
      if (draftStore) draftStoreDiscoveredAt = Date.now();
    }
    if (!draftStore) {
      discoveryAttempts += 1;
      if (discoveryAttempts < 80) scheduleSnapshot(250);
      return;
    }

    const hydrationDelayRemaining =
      draftStoreDiscoveredAt === null
        ? 0
        : 1_000 - (Date.now() - draftStoreDiscoveredAt);
    if (hydrationDelayRemaining > 0) {
      scheduleSnapshot(hydrationDelayRemaining);
      return;
    }

    const snapshot = buildEspnDraftSnapshot(
      draftStore,
      window.location.href,
      Date.now()
    );
    if (!snapshot) {
      draftStore = null;
      draftStoreDiscoveredAt = null;
      scheduleSnapshot(500);
      return;
    }

    discoveryAttempts = 0;
    const signature = JSON.stringify({
      draftId: snapshot.draft.draftId,
      status: snapshot.draft.status,
      teams: snapshot.draft.settings.teams,
      rounds: snapshot.draft.settings.rounds,
      myDraftSlot: snapshot.myDraftSlot ?? null,
      picks: snapshot.picks.map((pick) => [pick.pickNumber, pick.playerId]),
    });
    const now = Date.now();
    if (
      signature === lastSignature &&
      now - lastSnapshotEmittedAt < snapshotHeartbeatMs
    ) return;
    lastSignature = signature;
    lastSnapshotEmittedAt = now;

    const message = {
      source: ESPN_BRIDGE_SOURCE,
      version: ESPN_BRIDGE_VERSION,
      type: 'ESPN_DRAFT_SNAPSHOT',
      snapshot,
    } as const;
    window.postMessage(message, window.location.origin);
  };

  function scheduleSnapshot(delay = 0): void {
    if (pendingTimer !== null) return;
    pendingTimer = window.setTimeout(emitSnapshot, delay);
  }

  const observeFrame = (data: unknown) => {
    void readMessageData(data).then((text) => {
      if (getEspnDraftFrameCommand(text)) scheduleSnapshot();
    });
  };

  const NativeWebSocket = window.WebSocket;
  class ObservedWebSocket extends NativeWebSocket {
    public constructor(url: string | URL, protocols?: string | string[]) {
      if (protocols === undefined) {
        super(url);
      } else {
        super(url, protocols);
      }
      if (isEspnDraftEndpoint(url)) {
        this.addEventListener('open', () => {
          scheduleSnapshot();
        });
        this.addEventListener('message', (event) => {
          observeFrame(event.data);
        });
      }
    }
  }
  window.WebSocket = ObservedWebSocket;

  const NativeEventSource = window.EventSource;
  if (NativeEventSource) {
    class ObservedEventSource extends NativeEventSource {
      public constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
        super(url, eventSourceInitDict);
        if (isEspnDraftEndpoint(url)) {
          this.addEventListener('open', () => {
            scheduleSnapshot();
          });
          this.addEventListener('message', (event) => {
            observeFrame(event.data);
          });
        }
      }
    }
    window.EventSource = ObservedEventSource;
  }

  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    const data = asRecord(event.data);
    if (
      event.source === window &&
      event.origin === window.location.origin &&
      read(data, 'source') === ESPN_BRIDGE_SOURCE &&
      read(data, 'version') === ESPN_BRIDGE_VERSION &&
      read(data, 'type') === 'REQUEST_ESPN_DRAFT_SNAPSHOT'
    ) {
      scheduleSnapshot();
    }
  });

  scheduleSnapshot();
  window.setInterval(() => {
    scheduleSnapshot();
  }, 2_000);
}

installBridge();
