import { describe, expect, it } from 'vitest';
import type { OffensivePosition } from '@fantasy-draft/shared/league';
import { backtestInternals } from './backtest-recommendations.js';

function player(id: string, position: OffensivePosition, points: number = 100) {
  return {
    season: 2025,
    sleeper_player_id: id,
    gsis_id: id,
    player_name: id,
    position,
    games: 17,
    actual_points: points,
    rush_attempts: 0,
    receptions: 0,
    predraft_ecr: 1,
    trailing_points_per_game_3yr: 10,
    trailing_expected_points_per_game_3yr: 10,
    trailing_pass_attempts_per_game_3yr: null,
    trailing_rush_attempts_per_game_3yr: null,
    trailing_targets_per_game_3yr: null,
    trailing_player_volume_3yr: null,
    trailing_target_share_3yr: null,
    trailing_air_yards_share_3yr: null,
    trailing_offense_snap_share_3yr: 0.6,
    trailing_offense_snaps_per_game_3yr: null,
    trailing_pressure_rate_3yr: null,
    trailing_pressure_time_to_throw_3yr: null,
    trailing_number_pass_rushers_3yr: null,
    trailing_dropback_participation_per_game_3yr: null,
    trailing_charted_route_targets_per_game_3yr: null,
    trailing_targets_per_dropback_participation_3yr: null,
    trailing_deep_route_target_share_3yr: null,
    trailing_screen_route_target_share_3yr: null,
    trailing_goal_line_carries_per_game_3yr: null,
    trailing_goal_line_targets_per_game_3yr: null,
    trailing_completion_percentage_above_expectation_3yr: null,
    trailing_avg_time_to_throw_3yr: null,
    trailing_avg_intended_air_yards_3yr: null,
    trailing_avg_separation_3yr: null,
    trailing_avg_yac_above_expectation_3yr: null,
    trailing_expected_rush_points_per_game_3yr: null,
    trailing_expected_tds_per_game_3yr: null,
    trailing_rush_yards_over_expected_per_attempt_3yr: null,
    trailing_rush_pct_over_expected_3yr: null,
    history_seasons: 3,
    leagueActualPoints: points,
    leagueActualVor: points,
    customPositionRank: 1,
    baselineModelScore: 100,
    transparentModelScore: 100,
  } as const;
}

function metrics(overrides: Partial<{
  evaluatedPicks: number;
  vorCaptured: number;
  starterPoints: number;
  averageRegret: number;
  top24PositionHitRate: number;
}> = {}) {
  return {
    evaluatedPicks: 10,
    vorCaptured: 100,
    starterPoints: 1_000,
    averageRegret: 10,
    top24PositionHitRate: 0.6,
    ...overrides,
  };
}

describe('roster-aware backtest helpers', () => {
  it('derives the historical fixed, flex, and bench requirements', () => {
    expect(backtestInternals.deriveRosterRules([
      'QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'BN', 'BN',
    ])).toEqual({
      fixedStarters: { QB: 1, RB: 2, WR: 2, TE: 1 },
      flexStarters: 2,
      totalOffensiveSlots: 10,
    });
  });

  it('forces a missing starter when only one legal pick remains', () => {
    const rules = backtestInternals.deriveRosterRules(['QB', 'RB', 'WR']);
    const roster = backtestInternals.createRoster();
    roster.RB.push(player('rb', 'RB'));
    roster.WR.push(player('wr', 'WR'));

    expect(backtestInternals.isLegalCandidate(player('qb', 'QB'), roster, rules, 1)).toBe(true);
    expect(backtestInternals.isLegalCandidate(player('wr2', 'WR'), roster, rules, 1)).toBe(false);
  });

  it('scores fixed starters and the best remaining flex player', () => {
    const rules = backtestInternals.deriveRosterRules(['QB', 'RB', 'WR', 'TE', 'FLEX']);
    const roster = backtestInternals.createRoster();
    roster.QB.push(player('qb', 'QB', 300));
    roster.RB.push(player('rb1', 'RB', 200), player('rb2', 'RB', 150));
    roster.WR.push(player('wr1', 'WR', 210), player('wr2', 'WR', 180));
    roster.TE.push(player('te', 'TE', 170));

    expect(backtestInternals.calculateStarterPoints(roster, rules)).toBe(1060);
  });

  it('requires the feature family to improve the previous model before promotion', () => {
    const seasons = Array.from({ length: 4 }, () => ({
      strategies: {
        rosterAwareEcr: metrics(),
        rosterAwareBaselineModel: metrics({ starterPoints: 1_050 }),
        rosterAwareModel: metrics({
          starterPoints: 1_040,
          vorCaptured: 110,
          averageRegret: 9,
          top24PositionHitRate: 0.59,
        }),
      },
    }));
    const result = backtestInternals.evaluatePromotionGates(seasons, {
      rosterAwareEcr: metrics({ starterPoints: 4_000, vorCaptured: 400 }),
      rosterAwareBaselineModel: metrics({ starterPoints: 4_200 }),
      rosterAwareModel: metrics({
        starterPoints: 4_160,
        vorCaptured: 440,
        averageRegret: 9,
        top24PositionHitRate: 0.59,
      }),
    });

    expect(result.featureGatePassed).toBe(false);
    expect(result.releaseGatePassed).toBe(true);
    expect(result.promotionPassed).toBe(false);
  });

  it('requires three wins across a complete four-season release evaluation', () => {
    const winningSeason = {
      strategies: {
        rosterAwareEcr: metrics(),
        rosterAwareBaselineModel: metrics({ starterPoints: 990 }),
        rosterAwareModel: metrics({
          starterPoints: 1_050,
          vorCaptured: 110,
          averageRegret: 9,
          top24PositionHitRate: 0.59,
        }),
      },
    };
    const aggregateStrategies = {
      rosterAwareEcr: metrics({ starterPoints: 4_000, vorCaptured: 400 }),
      rosterAwareBaselineModel: metrics({ starterPoints: 3_960 }),
      rosterAwareModel: metrics({
        starterPoints: 4_200,
        vorCaptured: 440,
        averageRegret: 9,
        top24PositionHitRate: 0.59,
      }),
    };

    const partial = backtestInternals.evaluatePromotionGates(
      [winningSeason, winningSeason, winningSeason],
      aggregateStrategies
    );
    const complete = backtestInternals.evaluatePromotionGates(
      [winningSeason, winningSeason, winningSeason, {
        strategies: {
          ...winningSeason.strategies,
          rosterAwareModel: metrics({
            starterPoints: 900,
            vorCaptured: 110,
            averageRegret: 9,
            top24PositionHitRate: 0.59,
          }),
        },
      }],
      aggregateStrategies
    );

    expect(partial.releaseGateChecks.seasonsWon).toBe(false);
    expect(complete.releaseGateChecks.seasonsWon).toBe(true);
    expect(complete.promotionPassed).toBe(true);
  });

  it('retains every ECR release requirement as an independent hard gate', () => {
    const winningSeason = {
      strategies: {
        rosterAwareEcr: metrics(),
        rosterAwareBaselineModel: metrics({ starterPoints: 1_010 }),
        rosterAwareModel: metrics({
          starterPoints: 1_050,
          vorCaptured: 110,
          averageRegret: 9,
          top24PositionHitRate: 0.59,
        }),
      },
    };
    const losingSeason = {
      strategies: {
        ...winningSeason.strategies,
        rosterAwareModel: metrics({
          starterPoints: 900,
          vorCaptured: 110,
          averageRegret: 9,
          top24PositionHitRate: 0.59,
        }),
      },
    };
    const passingSeasons = [winningSeason, winningSeason, winningSeason, losingSeason];
    const passingAggregate = {
      rosterAwareEcr: metrics({
        starterPoints: 4_000,
        vorCaptured: 400,
        averageRegret: 10,
        top24PositionHitRate: 0.6,
      }),
      rosterAwareBaselineModel: metrics({ starterPoints: 4_050 }),
      rosterAwareModel: metrics({
        starterPoints: 4_100,
        vorCaptured: 410,
        averageRegret: 9.9,
        top24PositionHitRate: 0.58,
      }),
    };

    const passing = backtestInternals.evaluatePromotionGates(
      passingSeasons,
      passingAggregate
    );
    expect(passing.releaseGatePassed).toBe(true);

    const checkFailures = [
      backtestInternals.evaluatePromotionGates(
        [winningSeason, winningSeason, losingSeason, losingSeason],
        passingAggregate
      ).releaseGateChecks.seasonsWon,
      backtestInternals.evaluatePromotionGates(passingSeasons, {
        ...passingAggregate,
        rosterAwareModel: metrics({
          ...passingAggregate.rosterAwareModel,
          starterPoints: 4_000,
        }),
      }).releaseGateChecks.aggregateStarterPointsBeatEcr,
      backtestInternals.evaluatePromotionGates(passingSeasons, {
        ...passingAggregate,
        rosterAwareModel: metrics({
          ...passingAggregate.rosterAwareModel,
          vorCaptured: 400,
        }),
      }).releaseGateChecks.aggregateVorBeatEcr,
      backtestInternals.evaluatePromotionGates(passingSeasons, {
        ...passingAggregate,
        rosterAwareModel: metrics({
          ...passingAggregate.rosterAwareModel,
          averageRegret: 10,
        }),
      }).releaseGateChecks.averageRegretBeatEcr,
      backtestInternals.evaluatePromotionGates(passingSeasons, {
        ...passingAggregate,
        rosterAwareModel: metrics({
          ...passingAggregate.rosterAwareModel,
          top24PositionHitRate: 0.579,
        }),
      }).releaseGateChecks.top24HitRateNonInferior,
      backtestInternals.evaluatePromotionGates([
        winningSeason,
        winningSeason,
        winningSeason,
        {
          strategies: {
            ...winningSeason.strategies,
            rosterAwareModel: metrics({
              starterPoints: 849,
              vorCaptured: 110,
              averageRegret: 9,
              top24PositionHitRate: 0.59,
            }),
          },
        },
      ], passingAggregate).releaseGateChecks.noSeasonStarterRegressionOver15Percent,
    ];

    expect(checkFailures).toEqual([false, false, false, false, false, false]);
  });
});

describe('draft replay', () => {
  it('scores off-board picks and keepers and gives specialist picks no turn', () => {
    const board = [player('wr1', 'WR', 200), player('wr2', 'WR', 150), player('rb1', 'RB', 180)];
    const offBoardKeeper = { ...player('keep', 'WR', 120), predraft_ecr: null };
    const offBoardPick = { ...player('late', 'RB', 90), predraft_ecr: 280 };
    const undrafted = { ...player('nobody', 'TE', 50), predraft_ecr: null };
    const { playerSeasons, scoringRows } = backtestInternals.addDerivedValues(
      [...board, offBoardKeeper, offBoardPick, undrafted],
      new Set(['keep', 'late', 'wr1', 'wr2'].map((id) => backtestInternals.playerSeasonKey(2025, id)))
    );
    // Off-board players never join the board the strategies choose from.
    expect(playerSeasons.map((row) => row.sleeper_player_id).sort()).toEqual(['rb1', 'wr1', 'wr2']);
    const scoring = new Map(scoringRows.map((row) => [row.sleeper_player_id, row]));
    expect([...scoring.keys()].sort()).toEqual(['keep', 'late', 'rb1', 'wr1', 'wr2']);
    expect(scoring.get('keep')).toMatchObject({ leagueActualPoints: 120, customPositionRank: 3 });

    const plan = backtestInternals.planUserTurns([
      { pickNo: 1, playerId: 'keep', position: 'WR', isUserPick: true, isKeeper: true },
      { pickNo: 2, playerId: 'wr1', position: 'WR', isUserPick: false, isKeeper: false },
      { pickNo: 3, playerId: 'k1', position: 'K', isUserPick: true, isKeeper: false },
      { pickNo: 4, playerId: 'late', position: 'RB', isUserPick: true, isKeeper: false },
      { pickNo: 5, playerId: 'def1', position: 'DEF', isUserPick: true, isKeeper: false },
      { pickNo: 6, playerId: 'wr2', position: 'WR', isUserPick: true, isKeeper: false },
    ], scoring);

    expect(plan.keeperRows.map((row) => row.sleeper_player_id)).toEqual(['keep']);
    expect([...plan.turns.entries()].map(([index, turn]) =>
      [index, turn.pickNo, turn.remainingPicks, turn.chosenRow?.sleeper_player_id]
    )).toEqual([[3, 4, 2, 'late'], [5, 6, 1, 'wr2']]);
    const scored = [...plan.turns.values()].flatMap((turn) => turn.chosenRow ?? []);
    expect(backtestInternals.summarize(scored, [0, 0], 0)).toMatchObject({
      evaluatedPicks: 2,
      vorCaptured: (scoring.get('late')?.leagueActualVor ?? 0) + (scoring.get('wr2')?.leagueActualVor ?? 0),
    });
    expect(scoring.get('late')?.leagueActualVor).toBeGreaterThan(0);
  });
});

describe('prospective board', () => {
  it('builds the pool from the pre-draft ranking snapshot, falls back past post-draft scrapes, and keeps drafted players', async () => {
    const { DuckDBInstance } = await import('@duckdb/node-api');
    const instance = await DuckDBInstance.create(':memory:');
    const connection = await instance.connect();
    // Every training column the trailing history reads; unlisted ones stay null.
    const historyColumns = [
      'actual_points_per_game', 'expected_points_per_game', 'actual_value_over_replacement', 'pass_attempts',
      'rush_attempts', 'targets', 'games', 'dropback_participation', 'receptions', 'target_share', 'air_yards_share',
      'wopr', 'offense_snap_share', 'offense_snaps', 'pressure_rate', 'pressure_time_to_throw',
      'number_of_pass_rushers', 'charted_route_targets', 'deep_route_target_share', 'screen_route_target_share',
      'goal_line_carries', 'goal_line_targets', 'completion_percentage_above_expectation', 'avg_time_to_throw',
      'avg_intended_air_yards', 'avg_separation', 'avg_yac_above_expectation', 'intended_air_yards_share',
      'rush_yards_over_expected_per_attempt', 'rush_pct_over_expected', 'expected_pass_points',
      'expected_rec_points', 'expected_rush_points', 'expected_total_tds', 'availability_eligible_missed_games',
    ];
    const trainingRow = (season: number, gsisId: string, values: Record<string, number>) =>
      `select ${String(season)} as season, '${gsisId}' as gsis_id, ` +
      historyColumns.map((column) => `${String(values[column] ?? 'null')}::double as ${column}`).join(', ');
    try {
      for (const sql of [
        'create schema source',
        'create schema model',
        // a was an RB in his three prior seasons (2022 falls outside the window) and is a WR on draft day.
        `create table model.prediction_training_dataset as
          ${trainingRow(2022, 'g-a', { games: 10, actual_points_per_game: 30, rush_attempts: 100, targets: 50 })}
          union all ${trainingRow(2023, 'g-a', { games: 10, actual_points_per_game: 10, rush_attempts: 100, targets: 50 })}
          union all ${trainingRow(2024, 'g-a', { games: 10, actual_points_per_game: 12, rush_attempts: 100, targets: 50 })}
          union all ${trainingRow(2025, 'g-a', { games: 10, actual_points_per_game: 14, rush_attempts: 100, targets: 50 })}`,
        `create table model.prospective_player_outcomes as
          select 2026 as season, 'g-a' as gsis_id, 8.0 as games, 100.0 as ppr_points, 0.0 as rush_attempts,
            0.0 as receptions, 8 as team_games_played, 17 as team_games_scheduled`,
        `create table model.prospective_season_status as select 2026 as season, 272 as reg_games_scheduled,
          136 as reg_games_played, 136 as reg_games_with_stats, 9 as last_week_played, 'now' as fetched_at`,
        `create table model.dynastyprocess_player_ids as select * from (values
          ('fp-a', 'g-a', 's-a'), ('fp-c', 'g-c', 's-c'), ('fp-d', 'g-d', 's-d')
        ) as t(fantasypros_id, gsis_id, sleeper_player_id)`,
        // a: ranked, absent from today's player pool. c: re-ranked after the draft. d: drafted, never ranked.
        `create table source.dynastyprocess_rankings as select * from (values
          ('fp-a', 'Player A', 'WR', 'redraft-overall', 20.0, '2026-08-20'),
          ('fp-c', 'Player C', 'RB', 'redraft-overall', 10.0, '2026-08-20'),
          ('fp-c', 'Player C', 'RB', 'redraft-overall', 5.0, '2026-09-08')
        ) as t(id, player, pos, page_type, ecr, scrape_date)`,
      ]) await connection.run(sql);

      const load = await backtestInternals.loadProspectiveRows(connection, [{
        season: 2026,
        draftStartTimestamp: '2026-09-05T18:00:00.000Z',
        picks: [{ playerId: 's-d', playerName: 'Player D', position: 'QB' }],
      }]);

      expect(load.skipped).toEqual([]);
      const board = Object.fromEntries(load.rows.map((row) => [row.sleeper_player_id, row]));
      expect(Object.keys(board).sort()).toEqual(['s-a', 's-c', 's-d']);
      expect(board['s-a']).toMatchObject({ position: 'WR', predraft_ecr: 20, actual_points: 212.5 });
      // Trailing features come from his own prior seasons, and the workload input follows the draft-day position.
      expect(board['s-a']).toMatchObject({
        trailing_points_per_game_3yr: 12,
        trailing_rush_attempts_per_game_3yr: 10,
        trailing_player_volume_3yr: 150,
      });
      expect(board['s-c']).toMatchObject({ trailing_points_per_game_3yr: null, trailing_player_volume_3yr: 0 });
      expect(board['s-c']?.predraft_ecr).toBe(10);
      expect(board['s-d']).toMatchObject({ position: 'QB', predraft_ecr: null });
      expect(load.folds[0]).toMatchObject({ rankingsAfterDraft: 1, unrankedDrafted: 1, complete: false });
    } finally {
      connection.closeSync();
    }
  });
});
