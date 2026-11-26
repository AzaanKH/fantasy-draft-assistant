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
      [index, turn.pickNo, turn.remainingPicks, turn.nextPickNo, turn.chosenRow?.sleeper_player_id]
    )).toEqual([[3, 4, 2, 6, 'late'], [5, 6, 1, null, 'wr2']]);
    // The DEF pick between them is not the next chance to take an offensive player.
    const scored = [...plan.turns.values()].flatMap((turn) => turn.chosenRow ?? []);
    expect(backtestInternals.summarize(scored, [0, 0], 0)).toMatchObject({
      evaluatedPicks: 2,
      vorCaptured: (scoring.get('late')?.leagueActualVor ?? 0) + (scoring.get('wr2')?.leagueActualVor ?? 0),
    });
    expect(scoring.get('late')?.leagueActualVor).toBeGreaterThan(0);
  });
});

describe('prospective board', () => {
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

  async function loadBoard(options: {
    readonly gamesPlayed?: number;
    readonly extraSql?: readonly string[];
    readonly draftStartTimestamp?: string;
    readonly extraPicks?: ReadonlyArray<{ readonly playerId: string; readonly playerName: string; readonly position: 'QB' | 'RB' | 'WR' | 'TE' }>;
  } = {}) {
    const gamesPlayed = options.gamesPlayed ?? 136;
    const { DuckDBInstance } = await import('@duckdb/node-api');
    const instance = await DuckDBInstance.create(':memory:');
    const connection = await instance.connect();
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
        // a's two stints scheduled 18 team games, 11 of them played.
        `create table model.prospective_player_outcomes as
          select 2026 as season, 'g-a' as gsis_id, 8.0 as games, 100.0 as ppr_points, 0.0 as rush_attempts,
            0.0 as receptions, 11 as team_games_played, 18 as team_games_scheduled`,
        `create table model.prospective_season_status as select 2026 as season, 272 as reg_games_scheduled,
          ${String(gamesPlayed)} as reg_games_played, ${String(gamesPlayed)} as reg_games_with_stats,
          9 as last_week_played, 'now' as fetched_at`,
        `create table model.dynastyprocess_player_ids as select * from (values
          ('fp-a', 'g-a', 's-a'), ('fp-b', 'g-b', 's-b'), ('fp-c', 'g-c', 's-c'), ('fp-d', 'g-d', 's-d'),
          ('fp-e', 'g-e', 's-e')
        ) as t(fantasypros_id, gsis_id, sleeper_player_id)`,
        // a: ranked, absent from today's player pool. b and e: only in an older pre-draft snapshot, e drafted.
        // c: re-ranked after the draft. d: drafted, never ranked.
        `create table source.dynastyprocess_rankings as select * from (values
          ('fp-a', 'Player A', 'WR', 'redraft-overall', 20.0, '2026-08-20'),
          ('fp-b', 'Player B', 'WR', 'redraft-overall', 3.0, '2026-08-13'),
          ('fp-e', 'Player E', 'TE', 'redraft-overall', 4.0, '2026-08-13'),
          ('fp-c', 'Player C', 'RB', 'redraft-overall', 10.0, '2026-08-20'),
          ('fp-c', 'Player C', 'RB', 'redraft-overall', 5.0, '2026-09-08')
        ) as t(id, player, pos, page_type, ecr, scrape_date)`,
        ...(options.extraSql ?? []),
      ]) await connection.run(sql);

      return await backtestInternals.loadProspectiveRows(connection, [{
        season: 2026,
        draftStartTimestamp: options.draftStartTimestamp ?? '2026-09-05T18:00:00.000Z',
        picks: [
          { playerId: 's-d', playerName: 'Player D', position: 'QB' },
          { playerId: 's-e', playerName: 'Player E', position: 'TE' },
          ...(options.extraPicks ?? []),
        ],
      }]);
    } finally {
      connection.closeSync();
    }
  }

  it('builds the pool from the pre-draft ranking snapshot, falls back past post-draft scrapes, and keeps drafted players', async () => {
    const load = await loadBoard();
    expect(load.skipped).toEqual([]);
    const board = Object.fromEntries(load.rows.map((row) => [row.sleeper_player_id, row]));
    expect(Object.keys(board).sort()).toEqual(['s-a', 's-c', 's-d', 's-e']);
    // Season-to-date points at a 17-game pace over 11 team games played, not the 18 his stints scheduled.
    expect(board['s-a']?.actual_points).toBeCloseTo(100 * 17 / 11, 6);
    expect(board['s-a']).toMatchObject({ position: 'WR', predraft_ecr: 20 });
    // Trailing features come from his own prior seasons, and the workload input follows the draft-day position.
    expect(board['s-a']).toMatchObject({
      trailing_points_per_game_3yr: 12,
      trailing_rush_attempts_per_game_3yr: 10,
      trailing_player_volume_3yr: 150,
    });
    expect(board['s-c']).toMatchObject({ trailing_points_per_game_3yr: null, trailing_player_volume_3yr: 0 });
    expect(board['s-c']?.predraft_ecr).toBe(10);
    expect(board['s-d']).toMatchObject({ position: 'QB', predraft_ecr: null });
    // Missing from the latest pre-draft snapshot: no stale rank from an older one, so b is off the board and the
    // drafted e only scores.
    expect(board['s-e']).toMatchObject({ position: 'TE', predraft_ecr: null });
    expect(load.folds[0]).toMatchObject({ rankingsAfterDraft: 1, unrankedDrafted: 2, complete: false });
  });

  it('takes the newest pre-draft scrape even when it ranks a player with no Sleeper ID', async () => {
    // The newest pre-draft scrape ranks only f, who has no Sleeper ID; it is still the draft-day snapshot.
    const load = await loadBoard({
      extraSql: [`insert into source.dynastyprocess_rankings values
        ('fp-unmapped', 'Player F', 'WR', 'redraft-overall', 1.0, '2026-08-27')`],
    });
    const board = Object.fromEntries(load.rows.map((row) => [row.sleeper_player_id, row]));
    // f is not on the board and a, c are not carried in from the older scrape; the drafted d and e still score.
    expect(Object.keys(board).sort()).toEqual(['s-d', 's-e']);
    expect(load.rows.every((row) => row.predraft_ecr === null)).toBe(true);
  });

  it('bounds a scrape date at the following midnight UTC whatever the session time zone', async () => {
    // A September 5 scrape is known by 2026-09-06T00:00Z, two hours before this draft. A Los Angeles session would
    // put that midnight at 07:00Z and fall back to the August 20 board.
    const load = await loadBoard({
      draftStartTimestamp: '2026-09-06T02:00:00.000Z',
      extraSql: [
        `set TimeZone = 'America/Los_Angeles'`,
        `insert into source.dynastyprocess_rankings values ('fp-b', 'Player B', 'WR', 'redraft-overall', 3.0, '2026-09-05')`,
      ],
    });
    const board = Object.fromEntries(load.rows.map((row) => [row.sleeper_player_id, row]));
    expect(Object.keys(board).sort()).toEqual(['s-b', 's-d', 's-e']);
    expect(board['s-b']?.predraft_ecr).toBe(3);
    expect(load.folds[0]?.rankingsAfterDraft).toBe(1);
  });

  it('keeps a ranked player with no GSIS ID selectable, with an unknown outcome that withholds the fold gate', async () => {
    const load = await loadBoard({
      gamesPlayed: 272,
      extraSql: [
        `insert into model.dynastyprocess_player_ids values ('fp-g', null, 's-g'), ('fp-h', 'NA', 's-h')`,
        // g is the draft-day ECR #1 but has no GSIS ID, so no outcome can be joined.
        `insert into source.dynastyprocess_rankings values ('fp-g', 'Player G', 'RB', 'redraft-overall', 1.0, '2026-08-20')`,
      ],
      // 'NA' is the source's missing GSIS ID, not an ID.
      extraPicks: [{ playerId: 's-h', playerName: 'Player H', position: 'WR' }],
    });
    const board = Object.fromEntries(load.rows.map((row) => [row.sleeper_player_id, row]));
    // d is mapped but recorded no stats: a verified zero that still scores.
    expect(board['s-d']).toMatchObject({ actual_points: 0, games: 0 });
    expect(board['s-d']?.outcomeUnknown).toBeUndefined();
    // g stays on the board with his rank; h stays as a drafted scoring row. Both outcomes are unknown.
    expect(board['s-g']).toMatchObject({ predraft_ecr: 1, position: 'RB', outcomeUnknown: true });
    expect(board['s-h']).toMatchObject({ predraft_ecr: null, outcomeUnknown: true });
    expect(load.folds[0]).toMatchObject({ boardPlayers: 3, unrankedDrafted: 3, unresolvedOutcomes: 2 });

    const { playerSeasons, scoringRows } = backtestInternals.addDerivedValues(
      load.rows,
      new Set(['s-d', 's-e', 's-h'].map((id) => backtestInternals.playerSeasonKey(2026, id)))
    );
    const g = playerSeasons.find((row) => row.sleeper_player_id === 's-g');
    // The unknown outcome sets no actual rank or VOR; known players rank only among known outcomes.
    expect(g).toMatchObject({ customPositionRank: 0, leagueActualVor: 0, leagueActualPoints: 0 });
    expect(scoringRows.find((row) => row.sleeper_player_id === 's-h')?.outcomeUnknown).toBe(true);

    // The ECR strategy drafts its #1, exactly as the live app would, and carries him on its roster.
    const rules = backtestInternals.deriveRosterRules(['QB', 'RB', 'WR', 'TE', 'FLEX', 'BN']);
    const roster = backtestInternals.createRoster();
    const ecrPick = backtestInternals.chooseEcr(playerSeasons, roster, rules, 10);
    expect(ecrPick?.sleeper_player_id).toBe('s-g');
    if (!ecrPick) throw new Error('expected an ECR pick');
    backtestInternals.addToRoster(roster, ecrPick);
    const a = playerSeasons.find((row) => row.sleeper_player_id === 's-a');
    if (!a) throw new Error('expected player a');
    backtestInternals.addToRoster(roster, a);
    // Scored coverage leaves the unknown pick out instead of counting it as zero.
    expect(backtestInternals.summarize([ecrPick, a], [], 0)).toMatchObject({ evaluatedPicks: 1 });

    const unknownRosters = backtestInternals.unknownOutcomeStrategies({
      rosterAwareEcr: roster,
      rosterAwareModel: backtestInternals.createRoster(),
    });
    expect(unknownRosters).toEqual({ rosterAwareEcr: 1 });
    // A complete fold with a board would count; the unknown outcome withholds its gate result instead.
    const fold = load.folds[0];
    if (!fold) throw new Error('expected a fold');
    expect(backtestInternals.prospectiveFoldStanding(fold)).toMatchObject({ countsTowardReleaseGate: true });
    expect(backtestInternals.prospectiveFoldStanding(fold, unknownRosters)).toEqual({
      comparisonEvaluated: false,
      countsTowardReleaseGate: false,
      canReopen: false,
    });

    const plan = backtestInternals.planUserTurns([
      { pickNo: 1, playerId: 's-h', position: 'WR', isUserPick: true, isKeeper: false },
      { pickNo: 2, playerId: 's-d', position: 'QB', isUserPick: true, isKeeper: false },
    ], new Map(scoringRows.map((row) => [row.sleeper_player_id, row])));
    // h's pick keeps its turn and its roster slot; its outcome is unknown rather than zero.
    expect([...plan.turns.values()].map((turn) => [turn.remainingPicks, turn.chosenRow?.outcomeUnknown ?? false]))
      .toEqual([[2, true], [1, false]]);
  });

  it('leaves a complete fold with no ranked draft-day board out of the release gate', async () => {
    // Every scrape is after the draft: no pre-draft snapshot, so only the drafted players load.
    const load = await loadBoard({ gamesPlayed: 272, draftStartTimestamp: '2026-08-01T18:00:00.000Z' });
    const fold = load.folds[0];
    expect(fold).toMatchObject({ complete: true, boardPlayers: 0 });
    expect(fold && backtestInternals.prospectiveFoldStanding(fold)).toEqual({
      comparisonEvaluated: false,
      countsTowardReleaseGate: false,
      canReopen: false,
    });
    // The drafted players still score for the actual draft.
    expect(load.rows.map((row) => row.sleeper_player_id).sort()).toEqual(['s-d', 's-e']);
  });

  it('lets only a complete 2026 fold with a board reopen the model', () => {
    const standing = backtestInternals.prospectiveFoldStanding;
    expect(standing({ season: 2026, complete: true, boardPlayers: 200 }))
      .toEqual({ comparisonEvaluated: true, countsTowardReleaseGate: true, canReopen: true });
    expect(standing({ season: 2026, complete: false, boardPlayers: 200 }))
      .toEqual({ comparisonEvaluated: true, countsTowardReleaseGate: false, canReopen: false });
    // A later complete fold still counts toward its own release check but cannot reopen the frozen declaration.
    expect(standing({ season: 2027, complete: true, boardPlayers: 200 }))
      .toEqual({ comparisonEvaluated: true, countsTowardReleaseGate: true, canReopen: false });
  });

  it('replays only the draft-day board for a fold season, scoring each overlapping player once', () => {
    const ordinary = (id: string, points: number, ecr: number) => ({ ...player(id, 'WR', points), season: 2026, predraft_ecr: ecr });
    const history = [player('h1', 'WR', 120)];
    const rebuilt = [ordinary('absent', 300, 2), ordinary('a', 999, 1)];
    const prospective = [ordinary('a', 150, 1), ordinary('b', 90, 3)];
    const rows = backtestInternals.withProspectiveFolds([...history, ...rebuilt], prospective, [2026]);
    const { playerSeasons, scoringRows } = backtestInternals.addDerivedValues(
      rows,
      new Set(['absent', 'a'].map((id) => backtestInternals.playerSeasonKey(2026, id)))
    );
    const ids = (list: readonly { season: number; sleeper_player_id: string | null }[]) =>
      list.filter((row) => row.season === 2026).map((row) => row.sleeper_player_id).sort();
    // A rebuilt 2026 row for a player absent from the draft-day snapshot never reaches the board or the scoring.
    expect(ids(playerSeasons)).toEqual(['a', 'b']);
    expect(ids(scoringRows)).toEqual(['a', 'b']);
    // The overlapping player scores once, from the prospective row.
    expect(scoringRows.filter((row) => row.season === 2026 && row.sleeper_player_id === 'a')
      .map((row) => row.leagueActualPoints)).toEqual([150]);
    expect(playerSeasons.filter((row) => row.season === 2025).map((row) => row.sleeper_player_id)).toEqual(['h1']);
  });

  it('scores a complete season on raw totals', async () => {
    const load = await loadBoard({ gamesPlayed: 272 });
    expect(load.folds[0]?.complete).toBe(true);
    expect(load.rows.find((row) => row.sleeper_player_id === 's-a')?.actual_points).toBe(100);
  });

  it('keeps the pre-draft training window after a rebuild adds the season\'s own training rows', async () => {
    const before = await loadBoard();
    const after = await loadBoard({
      extraSql: [
        `insert into model.prediction_training_dataset
          ${trainingRow(2026, 'g-a', { games: 17, actual_points_per_game: 40, rush_attempts: 300, targets: 90 })}`,
        `insert into model.prediction_training_dataset
          ${trainingRow(2026, 'g-c', { games: 17, actual_points_per_game: 20, rush_attempts: 200, targets: 10 })}`,
      ],
    });
    expect(after.skipped).toEqual([]);
    expect(after).toEqual(before);
  });
});
