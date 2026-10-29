import { Deferred, Effect } from 'effect';

/**
 * Runs one poll at a time and shares it with every caller that arrives while it runs.
 * The poll runs in its own fiber, so an interrupted caller does not cancel it for the others.
 */
export class SharedPoll<A> {
  private running: Deferred.Deferred<A> | null = null;

  public constructor(private readonly run: () => Effect.Effect<A>) {}

  public get inFlight(): boolean { return this.running !== null; }

  /** Share the poll in progress, or start one. */
  public join(): Effect.Effect<A> {
    return Effect.suspend(() => {
      if (this.running) return Deferred.await(this.running);
      const started = Deferred.makeUnsafe<A>();
      this.running = started;
      Effect.runFork(this.run().pipe(
        Effect.exit,
        Effect.flatMap((exit) => Effect.sync(() => {
          this.running = null;
          Deferred.doneUnsafe(started, exit);
        })),
      ));
      return Deferred.await(started);
    });
  }

  /** Share a poll that starts after this call: wait out the one in progress, run `prepare`, then join. */
  public joinFresh(prepare: Effect.Effect<void>): Effect.Effect<A> {
    return Effect.gen({ self: this }, function* () {
      const earlier = this.running;
      if (earlier) yield* Deferred.await(earlier);
      yield* prepare;
      return yield* this.join();
    });
  }
}
