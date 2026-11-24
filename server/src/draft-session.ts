import type { ServerResponse } from 'node:http';
import { decodeProviderDraftSnapshot } from '@fantasy-draft/shared/catalog';
import {
  DraftSyncEngine,
  type DraftMetadata,
  type DraftPickEvent,
  type DraftProvider,
  type DraftSyncSnapshot,
  type DraftSyncUpdate,
} from '@fantasy-draft/shared/sync';
import { Effect, Fiber, type ManagedRuntime } from 'effect';
import { ObservationOrder } from './espn-observation.js';
import { writeBoundedEvent } from './http-security.js';
import { SharedPoll } from './shared-poll.js';
import { ProviderError, type DraftSyncAdapter } from './sync-adapter.js';

/**
 * Poll interval once the provider reports the draft complete. Each poll's heartbeat keeps CLI `draft watch` streams
 * connected without a separate keepalive, so the gap between frames should stay under its 30 s idle timeout
 * (cli/src/client.ts idleMs). With this default and no failures, the gap is at most 15 s sleep + 10 s worst-case
 * request timeout = 25 s. Failure backoff can stretch the sleep to its 30 s cap; a failed poll leaves the session
 * unsynced, so the next poll sends a status frame as it starts and the gap can reach 30 s.
 */
const COMPLETED_DRAFT_POLL_INTERVAL_MS = 15_000;

interface ClientConnection {
  readonly id: number;
  readonly response: ServerResponse;
}

/** One draft's sync state, its SSE clients and the poll loop that keeps them current. */
export class DraftSession {
  private readonly adapter: DraftSyncAdapter | null;
  private engine: DraftSyncEngine;
  public lastActivityAt = Date.now();
  private readonly clients = new Map<number, ClientConnection>();
  private readonly pollIntervalMs: number;
  private readonly requestTimeoutMs: number;
  private nextClientId = 1;
  private pollFiber: Fiber.Fiber<void> | null = null;
  private pollSleeping = false;
  private readonly poll: SharedPoll<boolean>;
  private consecutiveFailures = 0;
  private espnOrder = new ObservationOrder();

  public constructor(
    provider: DraftProvider,
    draftId: string,
    adapter: DraftSyncAdapter | null,
    pollIntervalMs: number,
    requestTimeoutMs: number,
    private readonly maxBufferedBytes: number,
    private readonly runtime: ManagedRuntime.ManagedRuntime<never, never>,
    private readonly completedPollIntervalMs = COMPLETED_DRAFT_POLL_INTERVAL_MS,
  ) {
    this.adapter = adapter;
    this.poll = new SharedPoll(() => this.performPoll(), runtime);
    this.engine = new DraftSyncEngine(provider, draftId);
    this.pollIntervalMs = pollIntervalMs;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  public getSnapshot(): DraftSyncSnapshot {
    return this.engine.getSnapshot();
  }

  public get clientCount(): number { return this.clients.size; }

  public get canEvict(): boolean { return this.clients.size === 0 && !this.poll.inFlight; }

  public reset(): DraftSyncSnapshot {
    const { provider, draftId } = this.engine.getSnapshot();
    this.engine = new DraftSyncEngine(provider, draftId);
    this.espnOrder = new ObservationOrder();
    this.lastActivityAt = Date.now();
    const snapshot = this.engine.getSnapshot();
    this.broadcast({ type: 'snapshot', snapshot });
    return snapshot;
  }

  public addClient(response: ServerResponse): number {
    this.adapter?.invalidateSettings?.();
    const id = this.nextClientId++;
    this.clients.set(id, { id, response });
    if (this.adapter) this.ensurePolling();
    this.send(
      {
        type: 'snapshot',
        snapshot: this.engine.getSnapshot(),
      },
      response
    );
    return id;
  }

  public removeClient(id: number): void {
    this.clients.delete(id);
    this.lastActivityAt = Date.now();
    if (this.clients.size === 0) {
      this.stopPolling();
    }
  }

  public dispose(): void {
    if (this.pollFiber) this.runtime.runFork(Fiber.interrupt(this.pollFiber));
    this.pollFiber = null;
    for (const { response } of this.clients.values()) {
      if (!response.writableEnded) {
        try {
          response.end();
        } catch {
          // A peer may close between the writable check and end().
        }
      }
    }
    this.clients.clear();
  }

  public refresh(): Effect.Effect<DraftSyncSnapshot> {
    return Effect.gen({ self: this }, function* () {
      const adapter = this.adapter;
      if (adapter) yield* this.poll.joinFresh(Effect.sync(() => adapter.invalidateSettings?.()));
      return this.engine.getSnapshot();
    });
  }

  public ingest(
    draft: DraftMetadata,
    picks: readonly DraftPickEvent[],
    observedAt: number,
    now: number
  ): DraftSyncSnapshot {
    const { snapshot, newPicks } = this.espnOrder.commit(observedAt, () => this.engine.reconcile(draft, picks, now));
    this.lastActivityAt = now;

    for (const pick of newPicks) {
      this.broadcast({ type: 'pick', snapshot, pick });
    }
    this.broadcast({ type: 'snapshot', snapshot });
    return snapshot;
  }

  private ensurePolling(): void {
    if (!this.adapter || this.pollFiber !== null) {
      return;
    }
    let finished = false;
    const fiber: Fiber.Fiber<void> = this.runtime.runFork(this.pollLoop().pipe(Effect.ensuring(Effect.sync(() => {
      finished = true;
      // pollFiber is still null if the loop ended before runFork returned, so fiber is never read early.
      if (this.pollFiber !== null && this.pollFiber === fiber) this.pollFiber = null;
    }))));
    if (!finished) this.pollFiber = fiber;
  }

  /** Stop between polls; a poll in progress finishes and the loop then sees no clients. */
  private stopPolling(): void {
    if (this.pollFiber !== null && this.pollSleeping) {
      this.runtime.runFork(Fiber.interrupt(this.pollFiber));
      this.pollFiber = null;
    }
  }

  /**
   * A completed draft rarely changes, so it is polled slowly rather than not at all: a late final pick or a reopened
   * draft still arrives, and failed polls keep the last successful status.
   */
  private pollLoop(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      for (;;) {
        yield* this.poll.join();
        if (this.clients.size === 0) return;
        const backoffMs = Math.min(this.pollIntervalMs * 2 ** this.consecutiveFailures, 30_000);
        const complete = this.engine.getSnapshot().draft?.status === 'complete';
        this.pollSleeping = true;
        yield* Effect.sleep(complete ? Math.max(this.completedPollIntervalMs, backoffMs) : backoffMs).pipe(
          Effect.ensuring(Effect.sync(() => { this.pollSleeping = false; })),
        );
      }
    });
  }

  private performPoll(): Effect.Effect<boolean> {
    return Effect.gen({ self: this }, function* () {
      const adapter = this.adapter;
      if (!adapter) return false;

      const wasSynced = this.engine.getSnapshot().status === 'synced';
      const syncingSnapshot = this.engine.beginSync();
      if (!wasSynced) {
        this.broadcast({ type: 'status', snapshot: syncingSnapshot });
      }

      const providerName = adapter.provider === 'yahoo' ? 'Yahoo' : 'Sleeper';
      const polled = yield* adapter.poll().pipe(
        Effect.timeoutOrElse({
          duration: this.requestTimeoutMs,
          orElse: () => Effect.fail(new ProviderError({ message: `${providerName} request timed out` })),
        }),
        Effect.flatMap((adapterSnapshot) => Effect.try({
          try: () => {
            const polledAt = Date.now();
            const decoded = decodeProviderDraftSnapshot(adapterSnapshot);
            return { polledAt, ...this.engine.reconcile(decoded.draft, decoded.picks, polledAt) };
          },
          catch: (cause) => new ProviderError({ message: cause instanceof Error ? cause.message : 'Unknown sync error', cause }),
        })),
        Effect.result,
      );

      if (polled._tag === 'Failure') {
        console.warn('[sync-server] Provider sync rejected', polled.failure.message);
        adapter.invalidateSettings?.();
        this.broadcast({
          type: 'status',
          snapshot: this.engine.failSync(polled.failure.message),
        });
        this.consecutiveFailures += 1;
        return false;
      }

      const { snapshot, newPicks, changed, polledAt } = polled.success;
      for (const pick of newPicks) {
        this.broadcast({
          type: 'pick',
          snapshot,
          pick,
        });
      }

      if (changed) {
        this.broadcast({ type: 'snapshot', snapshot });
      } else {
        this.broadcast({
          type: 'heartbeat',
          provider: snapshot.provider,
          draftId: snapshot.draftId,
          lastPolledAt: polledAt,
          lastSuccessfulSyncAt: polledAt,
        });
      }
      this.consecutiveFailures = 0;
      return true;
    });
  }

  private broadcast(update: DraftSyncUpdate): void {
    for (const { response } of this.clients.values()) {
      this.send(update, response);
    }
  }

  private send(update: DraftSyncUpdate, response: ServerResponse): void {
    writeBoundedEvent(response, `data: ${JSON.stringify(update)}\n\n`, this.maxBufferedBytes);
  }
}
