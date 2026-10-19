import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { decodeHistoricalSnapshotReport, decodeModelReport, decodeSourceMap, decodeLeagueHistory, decodeReadinessEvidence, decodeRehearsalEvidence, decodeOperationalEvidence, decodeTeamStatRows, decodeDemoPredictions, decodeHistoricalDraft } from './script-file-schemas.js';

describe('generated script file readers', () => {
  it('rejects malformed team statistics before ranking environments', () => {
    expect(() => decodeTeamStatRows([{ team: 'BUF', pass_attempts: '600' }])).toThrow();
  });
  it('drops only model prediction rows that lack demo inputs and warns visibly', () => {
    const warnings: string[] = [];
    const player = { playerId: '1', name: 'Player', position: 'QB', team: 'BUF', source: 'model', projectedPoints: 100, baseProjectedPoints: 90, valueOverReplacement: 20, uncertaintyScore: 3 };
    const decoded = decodeDemoPredictions({ generatedAt: '2026-09-01', modelVersion: 'test-fantasypros-free', players: [player, { ...player, playerId: undefined }] }, message => warnings.push(message));
    expect(decoded.players).toEqual([player]);
    expect(warnings).toEqual(['Dropped 1 prediction rows without required demo model inputs.']);
  });
  it('rejects historical draft files whose exact timestamps cannot be read', () => {
    expect(() => decodeHistoricalDraft({ draft_id: 'draft', league_id: 'league', season: '2025', start_time: 'yesterday' })).toThrow();
  });
  it('accepts the real model producer output and preserves producer metadata', async () => {
    const report: unknown = JSON.parse(await readFile(new URL('../../data/model-report.json', import.meta.url), 'utf8'));
    expect(decodeModelReport(report)).toEqual(report);
  });
  it.each([
    {},
    { currentSeason: '2026' },
    { generatedAt: 'now', modelVersion: 'test', currentSeason: 2026, seasons: [], positionResidualModels: { QB: { trainingRows: 'many' } }, counts: [] },
  ])('rejects malformed model evidence %j', value => {
    expect(() => decodeModelReport(value)).toThrow();
  });
  it('requires numeric cutoff counts from historical snapshot reports', () => {
    expect(() => decodeHistoricalSnapshotReport({ generatedAt: 'now', seasons: [{ season: 2026, cutoffViolations: '0' }] })).toThrow();
  });
  it('rejects invalid source-map contents instead of counting coerced bytes', () => {
    expect(() => decodeSourceMap({ sources: ['player.ts'], sourcesContent: [42] })).toThrow();
    expect(decodeSourceMap({ version: 3, sources: ['player.ts'], sourcesContent: ['let value = 1', null] })).toEqual({ version: 3, sources: ['player.ts'], sourcesContent: ['let value = 1', null] });
  });
  it('rejects malformed league-history picks before draft-prep aggregation', () => {
    expect(() => decodeLeagueHistory({ leagueName: 'League', seasons: [{ season: 2026, userSlot: 1, picks: [{ pickNo: '1' }], userPicks: [] }] })).toThrow();
  });
  it('rejects invalid release evidence at each producer file reader', () => {
    expect(() => decodeReadinessEvidence({ productBlockingFailures: [] })).toThrow();
    expect(() => decodeRehearsalEvidence({ status: 'passed', completion: 'complete' })).toThrow();
    expect(() => decodeOperationalEvidence({ realProviderRehearsal: { status: 'passed', completedAt: 123 } })).toThrow();
  });
  it('accepts actual readiness and deterministic rehearsal reports', async () => {
    for (const [file, decode] of [
      ['draft-readiness-report.json', decodeReadinessEvidence],
      ['primary-league-deterministic-rehearsal-report.json', decodeRehearsalEvidence],
    ] as const) {
      const report: unknown = JSON.parse(await readFile(new URL(`../../data/${file}`, import.meta.url), 'utf8'));
      expect(decode(report)).toEqual(report);
    }
  });
});
