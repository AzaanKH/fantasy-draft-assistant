import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ShadowRecommendationEvent } from '@fantasy-draft/shared';

interface StoredShadowRecommendationEvent extends ShadowRecommendationEvent {
  readonly recordedAt: string;
}

export class ShadowRecommendationLogger {
  private readonly outputPath: string;
  private readonly eventIds = new Set<string>();
  private operation = Promise.resolve();
  private initialized = false;

  public constructor(outputPath: string) {
    this.outputPath = outputPath;
  }

  public async record(event: ShadowRecommendationEvent): Promise<boolean> {
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
      await appendFile(this.outputPath, `${JSON.stringify(stored)}\n`, 'utf8');
      this.eventIds.add(event.eventId);
      recorded = true;
    });
    await this.operation;
    return recorded;
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const contents = await readFile(this.outputPath, 'utf8');
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
            this.eventIds.add(parsed.eventId);
          }
        } catch {
          // Preserve an existing malformed line and continue accepting new events.
        }
      }
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        throw error;
      }
    }
    this.initialized = true;
  }
}
