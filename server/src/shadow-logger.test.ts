import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ShadowRecommendationEvent } from '@fantasy-draft/shared';
import { ShadowRecommendationLogger } from './shadow-logger.js';

const EVENT: ShadowRecommendationEvent = {
  eventId: '2026:sleeper:recovery-draft:1',
  season: 2026,
  draftId: 'recovery-draft',
  pickNumber: 1,
  observedAt: '2026-08-20T18:00:00.000Z',
  experiment: {
    sourceLabel: 'Experimental prediction artifact',
    modelVersion: 'test-model',
    generatedAt: '2026-08-20T17:00:00.000Z',
    freshness: 'ready',
  },
  coreDecision: {
    ecrAnchor: 'FantasyPros ECR',
    policy: 'primary-league-policy',
    bestPick: { playerId: 'fallback-1', playerName: 'Fallback Player', position: 'RB', score: 100 },
    bestPlayer: { playerId: 'ecr-1', playerName: 'ECR Player', position: 'WR', score: -1 },
    recommendations: [
      { playerId: 'fallback-1', playerName: 'Fallback Player', position: 'RB', score: 100 },
    ],
  },
  shadowRecommendations: [
    { playerId: 'model-1', playerName: 'Model Player', position: 'WR', score: 101 },
  ],
  disagreement: true,
  context: {
    draftProvider: 'sleeper',
    leagueSettingsFingerprint: 'primary-league-test',
    totalTeams: 10,
    totalRounds: 15,
    myPickPosition: 1,
    draftedPlayerIds: [],
    rosterPlayerIds: [],
    positionNeeds: [{ position: 'RB', priority: 'critical' }],
  },
};

describe('ShadowRecommendationLogger', () => {
  it('rotates within a disk budget and remembers recent IDs across restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fantasy-shadow-bounds-'));
    const path = join(directory, 'events.ndjson');
    const maxFileBytes = Buffer.byteLength(JSON.stringify({ ...EVENT, recordedAt: new Date().toISOString() })) * 2;
    const limits = { maxFileBytes, maxEventIds: 2, maxPending: 2 };
    try {
      const logger = new ShadowRecommendationLogger(path, limits);
      for (let i = 0; i < 4; i++) await logger.record({ ...EVENT, eventId: `event-${i}` });
      expect((await readdir(directory)).sort()).toEqual(['events.ndjson', 'events.ndjson.1']);
      expect((await stat(path)).size).toBeLessThanOrEqual(maxFileBytes);
      expect((await stat(`${path}.1`)).size).toBeLessThanOrEqual(maxFileBytes);
      const restarted = new ShadowRecommendationLogger(path, limits);
      expect(await restarted.record({ ...EVENT, eventId: 'event-3' })).toBe(false);
      expect(await restarted.record({ ...EVENT, eventId: 'event-0' })).toBe(true);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('bounds legacy files and a burst of pending writes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fantasy-shadow-queue-'));
    const path = join(directory, 'events.ndjson');
    const limits = { maxFileBytes: 4096, maxEventIds: 10, maxPending: 1 };
    try {
      await writeFile(path, 'x'.repeat(8192));
      await writeFile(`${path}.1`, 'x'.repeat(8192));
      const logger = new ShadowRecommendationLogger(path, limits);
      const first = logger.record(EVENT);
      await expect(logger.record({ ...EVENT, eventId: 'second' })).rejects.toThrow('queue is full');
      await first;
      expect((await stat(path)).size).toBeLessThanOrEqual(4096);
      expect((await stat(`${path}.1`)).size).toBeLessThanOrEqual(4096);
      expect(await readFile(path, 'utf8')).toContain(EVENT.eventId);
      await expect(logger.record({ ...EVENT, eventId: 'later' })).resolves.toBe(true);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('accepts later events after a transient storage failure', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'fantasy-shadow-recovery-'));
    const logDirectory = join(temporaryDirectory, 'logs');
    const outputPath = join(logDirectory, 'recommendations.ndjson');
    const logger = new ShadowRecommendationLogger(outputPath);

    try {
      await writeFile(logDirectory, 'temporarily blocks directory creation');
      await expect(logger.record(EVENT)).rejects.toThrow();

      await rm(logDirectory);
      await mkdir(logDirectory);
      await expect(logger.record(EVENT)).resolves.toBe(true);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
