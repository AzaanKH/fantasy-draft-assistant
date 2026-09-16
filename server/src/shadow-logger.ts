import { appendFile, mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ShadowRecommendationEvent } from '@fantasy-draft/shared';
import { HttpError } from './http-security.js';

interface StoredShadowRecommendationEvent extends ShadowRecommendationEvent {
  readonly recordedAt: string;
}

export class ShadowRecommendationLogger {
  private readonly outputPath: string;
  private readonly eventIds = new Set<string>();
  private operation = Promise.resolve();
  private initialized = false;
  private pending = 0;
  private bytes = 0;

  public constructor(outputPath: string, private readonly limits = {
    maxFileBytes: 5 * 1024 * 1024,
    maxEventIds: 10_000,
    maxPending: 32,
  }) {
    this.outputPath = outputPath;
  }

  public async record(event: ShadowRecommendationEvent): Promise<boolean> {
    if (this.pending >= this.limits.maxPending) throw new HttpError(429, 'Shadow log queue is full');
    this.pending += 1;
    let recorded = false;
    // A transient write failure must reject that request without permanently
    // poisoning the queue for every later shadow decision.
    this.operation = this.operation.catch(() => undefined).then(async () => {
      await this.initialize();
      if (this.eventIds.has(event.eventId)) {
        return;
      }

      const stored: StoredShadowRecommendationEvent = {
        ...event,
        recordedAt: new Date().toISOString(),
      };
      await mkdir(dirname(this.outputPath), { recursive: true });
      const line = `${JSON.stringify(stored)}\n`;
      const bytes = Buffer.byteLength(line);
      if (bytes > this.limits.maxFileBytes) throw new HttpError(413, 'Shadow event is too large');
      if (this.bytes + bytes > this.limits.maxFileBytes) {
        await rm(`${this.outputPath}.1`, { force: true });
        await rename(this.outputPath, `${this.outputPath}.1`);
        this.bytes = 0;
      }
      await appendFile(this.outputPath, line, { encoding: 'utf8', mode: 0o600 });
      this.bytes += bytes;
      this.remember(event.eventId);
      recorded = true;
    });
    try {
      await this.operation;
      return recorded;
    } finally {
      this.pending -= 1;
    }
  }

  private remember(eventId: string): void {
    this.eventIds.add(eventId);
    if (this.eventIds.size > this.limits.maxEventIds) {
      const oldest = this.eventIds.values().next().value;
      if (oldest !== undefined) this.eventIds.delete(oldest);
    }
  }

  private async readBoundedLog(path: string): Promise<string> {
    const handle = await open(path, 'r');
    try {
      const size = (await handle.stat()).size;
      const length = Math.min(size, this.limits.maxFileBytes);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, size - length);
      let contents = buffer.subarray(0, bytesRead).toString('utf8');
      if (size > length) {
        // Discard the first partial record when retaining the tail of an old large log.
        const newline = contents.indexOf('\n');
        contents = newline < 0 ? '' : contents.slice(newline + 1);
        await writeFile(path, contents, { encoding: 'utf8', mode: 0o600 });
      }
      return contents;
    } finally { await handle.close(); }
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;

    // Replay the bounded archive first so the dedupe window favors recent entries.
    for (const path of [`${this.outputPath}.1`, this.outputPath]) {
      try {
        const contents = await this.readBoundedLog(path);
        if (path === this.outputPath) this.bytes = Buffer.byteLength(contents);
        for (const line of contents.split('\n')) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line) as unknown;
            if (
              typeof parsed === 'object' &&
              parsed !== null &&
              'eventId' in parsed &&
              typeof parsed.eventId === 'string'
            ) {
              this.remember(parsed.eventId);
            }
          } catch {
            // Preserve an existing malformed line and continue accepting new events.
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    this.initialized = true;
  }
}
