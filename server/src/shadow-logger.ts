import { appendFile, mkdir, open, rename, rm, writeFile, type FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Data, Effect, Semaphore } from 'effect';
import type { ShadowRecommendationEvent } from '@fantasy-draft/shared';
import { HttpError } from './http-security.js';

interface StoredShadowRecommendationEvent extends ShadowRecommendationEvent {
  readonly recordedAt: string;
}

/** The log could not be read or written; the request fails without blocking later events. */
export class ShadowLogError extends Data.TaggedError('ShadowLogError')<{ readonly cause: unknown }> {
  public override get message(): string {
    return this.cause instanceof Error ? this.cause.message : 'Shadow log I/O failed';
  }
}

const io = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: (cause) => new ShadowLogError({ cause }) });

export class ShadowRecommendationLogger {
  private readonly outputPath: string;
  private readonly eventIds = new Set<string>();
  // One writer at a time keeps rotation and the byte count consistent.
  private readonly writer = Semaphore.makeUnsafe(1);
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

  public record(event: ShadowRecommendationEvent): Effect.Effect<boolean, HttpError | ShadowLogError> {
    return Effect.suspend(() => {
      if (this.pending >= this.limits.maxPending) return Effect.fail(new HttpError(429, 'Shadow log queue is full'));
      this.pending += 1;
      // Waiting for the permit stays interruptible; a started append always finishes, so the
      // byte count and dedupe set match the file.
      return this.writer.withPermits(1)(Effect.uninterruptible(this.append(event))).pipe(
        Effect.ensuring(Effect.sync(() => { this.pending -= 1; })),
      );
    });
  }

  private append(event: ShadowRecommendationEvent): Effect.Effect<boolean, HttpError | ShadowLogError> {
    return Effect.gen({ self: this }, function* () {
      yield* this.initialize();
      if (this.eventIds.has(event.eventId)) return false;

      const stored: StoredShadowRecommendationEvent = {
        ...event,
        recordedAt: new Date().toISOString(),
      };
      yield* io(() => mkdir(dirname(this.outputPath), { recursive: true }));
      const line = `${JSON.stringify(stored)}\n`;
      const bytes = Buffer.byteLength(line);
      if (bytes > this.limits.maxFileBytes) return yield* new HttpError(413, 'Shadow event is too large');
      if (this.bytes + bytes > this.limits.maxFileBytes) {
        yield* io(async () => {
          await rm(`${this.outputPath}.1`, { force: true });
          await rename(this.outputPath, `${this.outputPath}.1`);
        });
        this.bytes = 0;
      }
      yield* io(() => appendFile(this.outputPath, line, { encoding: 'utf8', mode: 0o600 }));
      this.bytes += bytes;
      this.remember(event.eventId);
      return true;
    });
  }

  private remember(eventId: string): void {
    this.eventIds.add(eventId);
    if (this.eventIds.size > this.limits.maxEventIds) {
      const oldest = this.eventIds.values().next().value;
      if (oldest !== undefined) this.eventIds.delete(oldest);
    }
  }

  /** Read at most the size limit from the tail of a log; a missing log reads as null. */
  private readBoundedLog(path: string): Effect.Effect<string | null, ShadowLogError> {
    return Effect.acquireUseRelease(
      io(() => open(path, 'r')),
      (handle: FileHandle) => io(async () => {
        await handle.chmod(0o600);
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
      }),
      (handle) => Effect.promise(() => handle.close()),
    ).pipe(Effect.catchIf(
      (error) => (error.cause as NodeJS.ErrnoException | null)?.code === 'ENOENT',
      () => Effect.succeed(null),
    ));
  }

  private initialize(): Effect.Effect<void, ShadowLogError> {
    return Effect.gen({ self: this }, function* () {
      if (this.initialized) return;
      // Replay the bounded archive first so the dedupe window favors recent entries.
      for (const path of [`${this.outputPath}.1`, this.outputPath]) {
        const contents = yield* this.readBoundedLog(path);
        if (contents === null) continue;
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
      }
      this.initialized = true;
    });
  }
}
