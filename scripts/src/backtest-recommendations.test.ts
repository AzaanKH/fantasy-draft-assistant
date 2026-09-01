import { describe, expect, it } from 'vitest';
import type { Position } from '@fantasy-draft/shared';
import { backtestInternals } from './backtest-recommendations.js';

function player(id: string, position: Position, points: number = 100) {
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
