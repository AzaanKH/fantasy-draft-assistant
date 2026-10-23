import { describe, expect, it, vi } from 'vitest';
import { buildDraftReadinessReport } from './draft-readiness-report.js';
import { decodePredictionsDataFile } from './decoders.js';

const now = Date.parse('2026-08-25T16:00:00.000Z');
const timestamp = '2026-08-25T15:57:03.000Z';
const player = { name: 'Fixture', position: 'WR', team: 'DAL' };
const identity = { ...player, canonicalId: 'fixture', aliases: [] };

function readyFiles(): Map<string, unknown> {
  return new Map([
    ['data/fantasypros-snapshot.json', {
      metadata: { season: 2026, sourceType: 'api', source: 'fixture', refreshedAt: timestamp,
        rankingCount: 350, adpCount: 0, projectionCount: 0, newsCount: 0 },
      rankings: Array.from({ length: 350 }, () => ({ ...player, rank: 1, byeWeek: 1,
        positionalRank: 1, bestRank: 1, worstRank: 1, avgRank: 1 })), adp: [], projections: [], news: [],
    }],
    ['data/player-identity.json', { generatedAt: timestamp, season: 2026,
      coverage: { fantasyProsRankingMatchRate: 1, matchedDefenses: 32 },
      players: Array.from({ length: 800 }, () => identity) }],
    ['data/primary-league-settings.json', { season: 2026, leagueName: 'Ummati Official', source: 'sleeper',
      confirmedAt: timestamp, totalTeams: 10, totalRounds: 14,
      scoring: { passingTouchdown: 4, reception: 1, tightEndReceptionPremium: 0.5, rushAttemptBonus: 0.2 },
      roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, K: 1, DEF: 0, BENCH: 5 } }],
    ['data/league-history/current-keepers.json', { updatedAt: timestamp, season: 2026,
      keepers: Array.from({ length: 10 }, (_, index) => ({ playerName: `Keeper ${String(index)}`,
        position: 'WR', team: index + 1, round: 14 })) }],
    ['data/sleeper-adp.json', { fetchedAt: timestamp }],
  ]);
}

const reportFor = (files: Map<string, unknown>) => buildDraftReadinessReport(now, async path => ({
  path, error: null, value: files.get(path) ?? null,
}));

describe('core file readiness', () => {
  it('blocks the entire identity file when one row is malformed', async () => {
    const files = readyFiles();
    expect((await reportFor(files)).status).toBe('ready');
    files.set('data/player-identity.json', { generatedAt: timestamp, season: 2026,
      coverage: { fantasyProsRankingMatchRate: 1, matchedDefenses: 32 },
      players: [...Array.from({ length: 800 }, () => identity), { canonicalId: '', name: null }] });
    const report = await reportFor(files);
    expect(report.productBlockingFailures).toHaveLength(1);
    expect(report.productBlockingFailures[0]).toMatchObject({
      key: 'canonical-player-identities', problem: 'invalid', message: expect.stringContaining('players'),
    });
  });
});

describe('missing required core timestamps', () => {
  for (const [path, field] of [
    ['data/player-identity.json', 'generatedAt'], ['data/primary-league-settings.json', 'confirmedAt'],
    ['data/league-history/current-keepers.json', 'updatedAt'],
  ]) {
    it(`classifies missing ${field} as an invalid file with corrective action`, async () => {
      if (!path || !field) throw new Error('Missing timestamp fixture');
      const files = readyFiles();
      const value = files.get(path);
      if (typeof value !== 'object' || value === null) throw new Error('Missing core fixture');
      files.set(path, Object.fromEntries(Object.entries(value).filter(([key]) => key !== field)));
      const report = await reportFor(files);
      expect(report.productBlockingFailures).toHaveLength(1);
      expect(report.productBlockingFailures[0]?.problem).toBe('invalid');
      expect(report.productBlockingFailures[0]?.message).toContain(field);
      expect(report.productBlockingFailures[0]?.correctiveAction).not.toBe('');
    });
  }
});

describe('optional predictions readiness', () => {
  const prediction = { ...player, projectedPoints: 1, source: 'model' };
  it('drops a malformed row and warns while keeping otherwise ready core data usable', async () => {
    const files = readyFiles();
    files.set('data/predictions.json', { generatedAt: timestamp, modelVersion: 'fixture', players: [
      ...Array.from({ length: 800 }, () => prediction),
      { name: 'Broken', position: 'INVALID', projectedPoints: 'bad' },
    ] });
    const report = await reportFor(files);
    expect(report.status).toBe('ready');
    expect(report.actionableWarnings).toContainEqual(expect.objectContaining({ message: expect.stringMatching(/Dropped 1.*prediction/i) }));
    expect(report.optionalSignals.find(item => item.key === 'experimental-predictions')?.problem).not.toBe('invalid');
  });

  it('makes warning delivery opt-in and never logs from the decoder', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const file = { generatedAt: null, modelVersion: 'fixture', players: [prediction, null] };
    expect(decodePredictionsDataFile(file).players).toEqual([prediction]);
    const warnings: string[] = [];
    expect(decodePredictionsDataFile(file, { onWarning: message => warnings.push(message) }).players).toEqual([prediction]);
    expect(warn).not.toHaveBeenCalled();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Dropped 1 invalid prediction');
  });
});
