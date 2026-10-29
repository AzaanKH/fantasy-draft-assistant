import { Effect, Fiber } from 'effect';

/**
 * A read can be cancelled; an upload cannot, because each one carries draft
 * state the server must ingest.
 */
export type SnapshotRequestKind = 'read' | 'upload';

/**
 * Orders snapshot requests per draft: the newest request wins, and starting a
 * request cancels the draft's read still in flight.
 */
export interface SnapshotRequestLedger {
  /** Run `request`, which applies its result only while `isLatest()` holds. */
  run(
    draftKey: string,
    kind: SnapshotRequestKind,
    request: (isLatest: () => boolean) => Effect.Effect<void>
  ): void;
}

export function createSnapshotRequestLedger(): SnapshotRequestLedger {
  const latest = new Map<string, object>();
  const reads = new Map<string, Fiber.Fiber<void>>();

  const run: SnapshotRequestLedger['run'] = (draftKey, kind, request) => {
    const staleRead = reads.get(draftKey);
    if (staleRead) Effect.runFork(Fiber.interrupt(staleRead));
    reads.delete(draftKey);
    const token = {};
    latest.set(draftKey, token);
    const isLatest = () => latest.get(draftKey) === token;
    const fiber = Effect.runFork(request(isLatest).pipe(
      Effect.ensuring(Effect.sync(() => {
        if (isLatest()) latest.delete(draftKey);
      })),
    ));
    if (kind === 'read') {
      reads.set(draftKey, fiber);
      fiber.addObserver(() => {
        if (reads.get(draftKey) === fiber) reads.delete(draftKey);
      });
    }
  };

  return { run };
}
