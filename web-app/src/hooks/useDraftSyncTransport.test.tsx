// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DraftSyncTransportState } from '@/lib/draft-sync-state';
import { useDraftSyncTransport } from './useDraftSyncTransport';

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) { FakeEventSource.instances.push(this); }
  close() { this.readyState = FakeEventSource.CLOSED; }
  open() { this.readyState = FakeEventSource.OPEN; this.onopen?.(); }
  fail(readyState: number) { this.readyState = readyState; this.onerror?.(); }
}

let root: Root;
let queryClient: QueryClient;
let transportState: DraftSyncTransportState | undefined;

function Capture({ draftId }: { draftId: string | null }) {
  transportState = useDraftSyncTransport('sleeper', draftId).transportState;
  return null;
}

function mount(draftId: string | null) {
  act(() => {
    root.render(createElement(QueryClientProvider, { client: queryClient, children: createElement(Capture, { draftId }) }));
  });
}

function latest(): FakeEventSource {
  const stream = FakeEventSource.instances.at(-1);
  if (!stream) throw new Error('No EventSource was created');
  return stream;
}

function liveStreams(): FakeEventSource[] {
  return FakeEventSource.instances.filter((stream) => stream.readyState !== FakeEventSource.CLOSED);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
  FakeEventSource.instances = [];
  transportState = undefined;
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root = createRoot(document.createElement('div'));
});

afterEach(() => {
  act(() => { root.unmount(); });
  queryClient.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('reports a refused stream as an error and reconnects after a backoff', () => {
  mount('123');
  expect(transportState).toBe('connecting');
  expect(FakeEventSource.instances).toHaveLength(1);

  act(() => { latest().fail(FakeEventSource.CLOSED); });
  expect(transportState).toBe('error');

  act(() => { vi.advanceTimersByTime(999); });
  expect(FakeEventSource.instances).toHaveLength(1);
  expect(transportState).toBe('error');

  act(() => { vi.advanceTimersByTime(1); });
  expect(FakeEventSource.instances).toHaveLength(2);
  expect(latest().url).toBe('/api/sync/sleeper/drafts/123/events');
  expect(transportState).toBe('connecting');

  act(() => { latest().open(); });
  expect(transportState).toBe('connected');
  expect(liveStreams()).toHaveLength(1);
});

it('doubles the backoff while the server keeps refusing and resets it after an open', () => {
  mount('123');
  act(() => { latest().fail(FakeEventSource.CLOSED); });
  act(() => { vi.advanceTimersByTime(1000); });
  act(() => { latest().fail(FakeEventSource.CLOSED); });
  act(() => { vi.advanceTimersByTime(1999); });
  expect(FakeEventSource.instances).toHaveLength(2);
  act(() => { vi.advanceTimersByTime(1); });
  expect(FakeEventSource.instances).toHaveLength(3);

  act(() => { latest().open(); });
  act(() => { latest().fail(FakeEventSource.CLOSED); });
  act(() => { vi.advanceTimersByTime(1000); });
  expect(FakeEventSource.instances).toHaveLength(4);
  expect(liveStreams()).toHaveLength(1);
});

it('leaves a browser-managed retry to the browser', () => {
  mount('123');
  act(() => { latest().open(); });
  act(() => { latest().fail(FakeEventSource.CONNECTING); });
  expect(transportState).toBe('reconnecting');

  act(() => { vi.advanceTimersByTime(60_000); });
  expect(FakeEventSource.instances).toHaveLength(1);
});

it('creates no stream after unmounting during a backoff', () => {
  mount('123');
  act(() => { latest().fail(FakeEventSource.CLOSED); });
  act(() => { root.unmount(); });
  act(() => { vi.advanceTimersByTime(60_000); });
  expect(FakeEventSource.instances).toHaveLength(1);
  root = createRoot(document.createElement('div'));
});

it('opens no sync connection without a draft', () => {
  mount(null);
  expect(transportState).toBe('disconnected');
  expect(FakeEventSource.instances).toHaveLength(0);
});
