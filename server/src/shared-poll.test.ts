import { describe, expect, it, vi } from 'vitest';
import { Deferred, Effect, Fiber } from 'effect';
import { SharedPoll } from './shared-poll.js';

function gatedPoll() {
  const gates: Deferred.Deferred<true>[] = [];
  const poll = new SharedPoll(() => Effect.suspend(() => {
    const gate = Deferred.makeUnsafe<true>();
    gates.push(gate);
    return Deferred.await(gate).pipe(Effect.as(gates.length));
  }));
  const finish = (index: number) => Effect.runPromise(Deferred.succeed(gates[index]!, true));
  return { poll, gates, finish };
}

describe('SharedPoll', () => {
  it('shares the poll in progress with every joining caller', async () => {
    const { poll, gates, finish } = gatedPoll();
    const first = Effect.runPromise(poll.join());
    const second = Effect.runPromise(poll.join());
    expect(gates).toHaveLength(1);
    expect(poll.inFlight).toBe(true);
    await finish(0);
    expect(await Promise.all([first, second])).toEqual([1, 1]);
    expect(poll.inFlight).toBe(false);
  });

  it('gives fresh joiners one shared poll that starts after the poll in progress', async () => {
    const { poll, gates, finish } = gatedPoll();
    const ongoing = Effect.runPromise(poll.join());
    let prepared = 0;
    const prepare = Effect.sync(() => { prepared += 1; });
    const fresh = [Effect.runPromise(poll.joinFresh(prepare)), Effect.runPromise(poll.joinFresh(prepare))];
    expect(prepared).toBe(0);
    await finish(0);
    expect(await ongoing).toBe(1);
    await vi.waitFor(() => { expect(gates).toHaveLength(2); });
    expect(prepared).toBe(2);
    await finish(1);
    expect(await Promise.all(fresh)).toEqual([2, 2]);
  });

  it('keeps polling for the others when one caller is interrupted', async () => {
    const { poll, gates, finish } = gatedPoll();
    const interrupted = Effect.runFork(poll.join());
    const remaining = Effect.runPromise(poll.join());
    await Effect.runPromise(Fiber.interrupt(interrupted));
    await finish(0);
    expect(await remaining).toBe(1);
    expect(gates).toHaveLength(1);
  });
});
