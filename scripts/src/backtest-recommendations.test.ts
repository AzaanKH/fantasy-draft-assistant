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
    trailing_offense_snap_share_3yr: 0.6,
    trailing_completion_percentage_above_expectation_3yr: null,
    trailing_avg_separation_3yr: null,
    trailing_avg_yac_above_expectation_3yr: null,
    trailing_rush_yards_over_expected_per_attempt_3yr: null,
    trailing_rush_pct_over_expected_3yr: null,
    leagueActualPoints: points,
    leagueActualVor: points,
    customPositionRank: 1,
    baselineModelScore: 100,
    transparentModelScore: 100,
  } as const;
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
});
