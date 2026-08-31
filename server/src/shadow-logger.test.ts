import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
