import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export class HttpError extends Error {
  public constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export function hasRequestToken(request: IncomingMessage, expected: string): boolean {
  const token = request.headers['x-sync-token'];
  if (typeof token !== 'string' || !expected) return false;
  const actualBytes = Buffer.from(token);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export const DEFAULT_RESOURCE_LIMITS = {
  maxSessions: 16,
  maxClients: 32,
  maxClientsPerSession: 8,
  maxBufferedBytes: 256 * 1024,
  idleSessionMs: 10 * 60_000,
  requestsPerMinute: 300,
  maxConcurrentRequests: 32,
  maxConnections: 64,
} as const;

export type ResourceLimits = { [Key in keyof typeof DEFAULT_RESOURCE_LIMITS]: number };

/** A single bounded budget for this single-user loopback service, with no growing IP map. */
export class RequestBudget {
  private remaining: number;
  private resetsAt = Date.now() + 60_000;
  public constructor(private readonly perMinute: number) {
    this.remaining = perMinute;
  }
  public take(now: number = Date.now()): boolean {
    if (now >= this.resetsAt) {
      this.resetsAt = now + 60_000;
      this.remaining = this.perMinute;
    }
    if (this.remaining <= 0) return false;
    this.remaining -= 1;
    return true;
  }
}

const pendingDrains = new WeakMap<ServerResponse, NodeJS.Timeout>();

export function writeBoundedEvent(response: ServerResponse, frame: string, maxBytes: number): void {
  if (response.destroyed || response.writableEnded) return;
  if (response.writableLength + Buffer.byteLength(frame) > maxBytes) {
    response.destroy();
    return;
  }
  if (!response.write(frame) && !pendingDrains.has(response)) {
    const cleanup = () => {
      clearTimeout(timer);
      pendingDrains.delete(response);
      response.off('drain', cleanup);
      response.off('close', cleanup);
    };
    const timer = setTimeout(() => { cleanup(); response.destroy(); }, 5000);
    timer.unref();
    pendingDrains.set(response, timer);
    response.once('drain', cleanup);
    response.once('close', cleanup);
  }
}
