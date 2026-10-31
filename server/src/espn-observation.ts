import { HttpError } from './http-security.js';

const MAX_CLOCK_SKEW_MS = 5 * 60_000;

export function assertObservedNearNow(observedAt: number, now: number): void {
  if (Math.abs(observedAt - now) > MAX_CLOCK_SKEW_MS) {
    throw new HttpError(400, 'ESPN observation time must be within five minutes of the server clock');
  }
}

/** Accepts ESPN snapshots in observation order; only a snapshot that applies moves the order forward. */
export class ObservationOrder {
  private latest: number | null = null;

  public commit<A>(observedAt: number, apply: () => A): A {
    if (this.latest !== null && observedAt < this.latest) throw new HttpError(409, 'Stale ESPN snapshot');
    const applied = apply();
    this.latest = observedAt;
    return applied;
  }
}
