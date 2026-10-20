import { POSITION_FEATURES } from './model/position-residual-model.js';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { decodeHistoricalSnapshotReport, decodeModelReport, decodeSourceMap, decodeLeagueHistory, decodeReadinessEvidence, decodeRehearsalEvidence, decodeOperationalEvidence, decodeTeamStatRows, decodeDemoPredictions, decodeHistoricalDraft, decodeHistoricalValidationRows, decodeHistoricalCoverageRows, decodeBacktestTrainingRows, decodeDemoByeWeekRows, decodeDemoComponentRows, decodePredictionOutputRows, decodeDuckDbTableCounts, decodeProfileCoverageRows, decodeProfilePositionRows, decodeResidualTrainingRows } from './script-file-schemas.js';

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


describe('DuckDB producer boundaries', () => {
  const validation = { season: 2026n, sleeper_player_id: null, max_information_timestamp: null, draft_timestamp: '2026-09-01' };
  const coverage = { season: 2026, draft_id: 'draft', draft_timestamp: '2026-09-01', players: 1n,
    with_team: 1n, with_roster_status: 0n, with_active_status: 0n, with_pup_status: 0n, with_ir_status: 0n,
    with_injury_designation: 0n, with_depth_chart: 0n, with_prior_season_missed_games: 0n,
    with_same_position_competition: 0n, with_recent_trade: 0n, cutoff_violations: 0n };
  const component = { sleeper_player_id: 'p1', projected_rush_attempts: 1, projected_receptions: 2,
    history_seasons: 0n, passing_yards: null, passing_tds: null, rushing_yards: null, rushing_tds: null,
    receiving_yards: null, receiving_tds: null };
  const prediction = { player_id: 1n, player_name: 'Player', position: 'QB', team: 'BUF',
    base_projected_points: 1, usage_efficiency_adjustment: 0, custom_scoring_adjustment: 0,
    projected_points: 1, floor_projected_points: 0, ceiling_projected_points: 2,
    position_percentile: 50, value_over_replacement: 0, ceiling_score: 5, floor_score: 5,
    uncertainty_score: 0, injury_risk_score: 0, model_family: 'model' };
  const profile = { total_players: 1n, with_ecr: 1n, with_projection: 1n,
    with_team_environment: 1n, with_news: 0n, rookies: 0n, limited_experience: 0n };
  const position = { position: 'QB', total_players: 1n, with_ecr: 1n, with_projection: 1n,
    avg_sleeper_adp: null, avg_ecr_rank: 1 };

  const residual = {
    ...Object.fromEntries([...Object.values(POSITION_FEATURES).flat(), 'actual_points',
      'actual_points_per_game', 'trailing_player_volume_3yr'].map(key => [key, null])),
    season: 2026n, position: 'QB', target_residual: 0,
  };

  it.each([
    ['historical validation', decodeHistoricalValidationRows, validation, { ...validation, draft_timestamp: 42 }],
    ['historical coverage', decodeHistoricalCoverageRows, coverage, { ...coverage, players: 'many' }],
    ['demo bye weeks', decodeDemoByeWeekRows, { team: 'BUF', bye_week: 5n }, { team: 'BUF', bye_week: 'five' }],
    ['demo components', decodeDemoComponentRows, component, { ...component, projected_receptions: null }],
    ['prediction output', decodePredictionOutputRows, prediction, { ...prediction, projected_points: 'one' }],
    ['table counts', decodeDuckDbTableCounts, { table_name: 'players', row_count: 1n }, { table_name: 'players', row_count: null }],
    ['profile coverage', decodeProfileCoverageRows, profile, { ...profile, with_ecr: null }],
    ['profile positions', decodeProfilePositionRows, position, { ...position, avg_ecr_rank: 'one' }],
    ['residual features', decodeResidualTrainingRows,
      residual, { ...residual, trailing_player_volume_3yr: 'many' }],
  ])('rejects malformed %s rows atomically and preserves DuckDB scalar types', (_name, decode, good, bad) => {
    expect(decode([good])).toEqual([good]);
    expect(() => decode([good, bad])).toThrow();
  });

  it('rejects incomplete backtest rows before simulation', () => {
    expect(() => decodeBacktestTrainingRows([{ season: 2026, player_name: 'Player', position: 'WR' }])).toThrow();
  });
});
