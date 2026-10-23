import { Schema } from 'effect';
import { decodePredictionsDataFile } from '@fantasy-draft/shared/catalog';
import { POSITIONS } from '@fantasy-draft/shared/league';

function openStruct<const Fields extends Schema.Struct.Fields>(fields: Fields) {
  return Schema.StructWithRest(Schema.Struct(fields), [Schema.Record(Schema.String, Schema.Unknown)]);
}

const modelPosition = openStruct({
  modelFamily: Schema.String,
  candidateSetVersion: Schema.String,
  specificationId: Schema.String,
  featureNames: Schema.Array(Schema.String),
  volumeThreshold: Schema.Finite,
  ridgeLambda: Schema.Finite,
  selectedWithTrainingSeasons: Schema.Array(Schema.Finite),
  innerValidationSeason: Schema.NullOr(Schema.Finite),
  trainingRows: Schema.Finite,
  trainedThroughSeason: Schema.NullOr(Schema.Finite),
});
const modelReport = openStruct({
  generatedAt: Schema.String,
  modelVersion: Schema.String,
  seasons: Schema.Array(Schema.Finite),
  currentSeason: Schema.Finite,
  positionResidualModels: Schema.Struct({ QB: modelPosition, RB: modelPosition, WR: modelPosition, TE: modelPosition }),
  counts: Schema.Array(openStruct({ tableName: Schema.String, rowCount: Schema.Finite })),
});
const historicalSnapshotReport = openStruct({
  generatedAt: Schema.String,
  seasons: Schema.Array(openStruct({
    season: Schema.Finite, draftId: Schema.String, draftTimestamp: Schema.String,
    players: Schema.Finite, cutoffViolations: Schema.Finite,
  })),
});
const sourceMap = openStruct({
  sources: Schema.optional(Schema.Array(Schema.String)),
  sourcesContent: Schema.optional(Schema.Array(Schema.NullOr(Schema.String))),
});
const pick = openStruct({
  pickNo: Schema.Finite, round: Schema.Finite, playerName: Schema.String,
  position: Schema.Literals(POSITIONS), isKeeper: Schema.Boolean,
});
const leagueHistory = openStruct({
  leagueName: Schema.String,
  seasons: Schema.Array(openStruct({
    season: Schema.Finite, userSlot: Schema.Finite,
    picks: Schema.Array(pick), userPicks: Schema.Array(pick),
  })),
});
const failure = openStruct({ key: Schema.String, label: Schema.String, message: Schema.String });
const readinessEvidence = openStruct({
  generatedAt: Schema.String,
  status: Schema.Literals(['ready', 'blocked']),
  productBlockingFailures: Schema.Array(failure),
  actionableWarnings: Schema.Array(failure),
  optionalSignalDegradations: Schema.Array(failure),
});
const rehearsalEvidence = openStruct({
  generatedAt: Schema.String, status: Schema.Literals(['passed', 'failed']),
  configuration: openStruct({ totalTeams: Schema.Finite, totalRounds: Schema.Finite, totalPicks: Schema.Finite, keeperCount: Schema.Finite }),
  transitions: openStruct({ observed: Schema.Finite, recommendationChecks: Schema.Finite }),
  reconciliation: openStruct({ confirmations: Schema.Finite, corrections: Schema.Finite, removals: Schema.Finite }),
  completion: openStruct({ canonicalPicks: Schema.Finite, providerPicks: Schema.Finite, keeperPicks: Schema.Finite }),
  failures: Schema.Array(Schema.String),
});
const operationalEvidence = openStruct({
  season: Schema.optional(Schema.Finite), provider: Schema.optional(Schema.String),
  draftId: Schema.optional(Schema.String), leagueId: Schema.optional(Schema.String),
  recordedAt: Schema.optional(Schema.String), scheduledStartAt: Schema.optional(Schema.String),
  timezone: Schema.optional(Schema.String), pickTimerSeconds: Schema.optional(Schema.Finite),
  providerStatus: Schema.optional(Schema.String),
  realProviderRehearsal: Schema.optional(openStruct({
    status: Schema.optional(Schema.String), completedAt: Schema.optional(Schema.NullOr(Schema.String)),
    notes: Schema.optional(Schema.String),
  })),
});

export const decodeModelReport = Schema.decodeUnknownSync(modelReport);
export const decodeHistoricalSnapshotReport = Schema.decodeUnknownSync(historicalSnapshotReport);
export const decodeSourceMap = Schema.decodeUnknownSync(sourceMap);
export const decodeLeagueHistory = Schema.decodeUnknownSync(leagueHistory);
export const decodeReadinessEvidence = Schema.decodeUnknownSync(readinessEvidence);
export const decodeRehearsalEvidence = Schema.decodeUnknownSync(rehearsalEvidence);
export const decodeOperationalEvidence = Schema.decodeUnknownSync(operationalEvidence);

const backtestLeagueHistory = openStruct({
  seasons: Schema.Array(openStruct({
    season: Schema.Finite,
    rosterPositions: Schema.Array(Schema.String),
    rosterIdToOwner: Schema.Record(Schema.String, Schema.NullOr(Schema.String)),
    picks: Schema.Array(openStruct({
      pickNo: Schema.Finite, round: Schema.Finite, rosterId: Schema.Finite,
      playerId: Schema.String, playerName: Schema.String, position: Schema.Literals(POSITIONS),
      isUserPick: Schema.Boolean, isKeeper: Schema.Boolean,
    })),
  })),
});
const survivalHistoryPick = openStruct({
  pickNo: Schema.Finite, draftSlot: Schema.Finite,
  pickedByDisplayName: Schema.String, position: Schema.Literals(POSITIONS),
});
const survivalHistory = openStruct({
  leagueName: Schema.String,
  seasons: Schema.Array(openStruct({
    season: Schema.Finite, leagueName: Schema.String, picks: Schema.Array(survivalHistoryPick),
  })),
});
const teamStatRow = Schema.Struct({
  team: Schema.String, pass_attempts: Schema.Finite, rush_attempts: Schema.Finite,
  total_yards: Schema.Finite, offensive_tds: Schema.Finite,
  passing_epa: Schema.Finite, rushing_epa: Schema.Finite,
});
const historicalDraft = Schema.Struct({
  draft_id: Schema.String, league_id: Schema.String,
  season: Schema.String.check(Schema.makeFilter(value => Number.isInteger(Number(value)))),
  start_time: Schema.Finite,
});
const demoPredictionInputs = Schema.Struct({
  playerId: Schema.String, baseProjectedPoints: Schema.Finite,
  valueOverReplacement: Schema.Finite, uncertaintyScore: Schema.Finite,
});
const hasDemoPredictionInputs = Schema.is(demoPredictionInputs);

export const decodeBacktestLeagueHistory = Schema.decodeUnknownSync(backtestLeagueHistory);
export const decodeSurvivalHistory = Schema.decodeUnknownSync(survivalHistory);
export type SurvivalHistoryPick = typeof survivalHistoryPick.Type;
export const decodeTeamStatRows = Schema.decodeUnknownSync(Schema.Array(teamStatRow));
export const decodeHistoricalDraft = Schema.decodeUnknownSync(historicalDraft);

export function decodeDemoPredictions(value: unknown, onWarning: (message: string) => void): Omit<ReturnType<typeof decodePredictionsDataFile>, 'generatedAt' | 'players'> & { readonly generatedAt: string; readonly players: readonly (ReturnType<typeof decodePredictionsDataFile>['players'][number] & typeof demoPredictionInputs.Type)[] } {
  const decoded = decodePredictionsDataFile(value, { onWarning });
  if (decoded.generatedAt === null) throw new Error('Demo model predictions require generatedAt.');
  const players = decoded.players.flatMap(player => hasDemoPredictionInputs(player) ? [player] : []);
  const dropped = decoded.players.length - players.length;
  if (dropped > 0) onWarning(`Dropped ${dropped} prediction rows without required demo model inputs.`);
  return { ...decoded, generatedAt: decoded.generatedAt, players };
}

const duckdbCount = Schema.Union([Schema.Finite, Schema.BigInt]);
const historicalValidationRow = Schema.Struct({
  season: duckdbCount, sleeper_player_id: Schema.NullOr(Schema.String),
  max_information_timestamp: Schema.NullOr(Schema.String), draft_timestamp: Schema.String,
});
const historicalCoverageRow = Schema.Struct({
  season: duckdbCount, draft_id: Schema.String, draft_timestamp: Schema.String,
  players: duckdbCount, with_team: duckdbCount, with_roster_status: duckdbCount,
  with_active_status: duckdbCount, with_pup_status: duckdbCount, with_ir_status: duckdbCount,
  with_injury_designation: duckdbCount, with_depth_chart: duckdbCount,
  with_prior_season_missed_games: duckdbCount, with_same_position_competition: duckdbCount,
  with_recent_trade: duckdbCount, cutoff_violations: duckdbCount,
});
export const decodeHistoricalValidationRows = Schema.decodeUnknownSync(Schema.Array(historicalValidationRow));
export const decodeHistoricalCoverageRows = Schema.decodeUnknownSync(Schema.Array(historicalCoverageRow));

const backtestTrainingRow = Schema.Struct({
  season: Schema.Finite,
  sleeper_player_id: Schema.NullOr(Schema.String),
  gsis_id: Schema.NullOr(Schema.String),
  player_name: Schema.String,
  position: Schema.Literals(POSITIONS),
  games: Schema.Finite,
  actual_points: Schema.Finite,
  rush_attempts: Schema.Finite,
  receptions: Schema.Finite,
  predraft_ecr: Schema.NullOr(Schema.Finite),
  trailing_points_per_game_3yr: Schema.NullOr(Schema.Finite),
  trailing_expected_points_per_game_3yr: Schema.NullOr(Schema.Finite),
  trailing_pass_attempts_per_game_3yr: Schema.NullOr(Schema.Finite),
  trailing_rush_attempts_per_game_3yr: Schema.NullOr(Schema.Finite),
  trailing_targets_per_game_3yr: Schema.NullOr(Schema.Finite),
  trailing_player_volume_3yr: Schema.NullOr(Schema.Finite),
  trailing_target_share_3yr: Schema.NullOr(Schema.Finite),
  trailing_air_yards_share_3yr: Schema.NullOr(Schema.Finite),
  trailing_offense_snap_share_3yr: Schema.NullOr(Schema.Finite),
  trailing_offense_snaps_per_game_3yr: Schema.NullOr(Schema.Finite),
  trailing_pressure_rate_3yr: Schema.NullOr(Schema.Finite),
  trailing_pressure_time_to_throw_3yr: Schema.NullOr(Schema.Finite),
  trailing_number_pass_rushers_3yr: Schema.NullOr(Schema.Finite),
  trailing_dropback_participation_per_game_3yr: Schema.NullOr(Schema.Finite),
  trailing_charted_route_targets_per_game_3yr: Schema.NullOr(Schema.Finite),
  trailing_targets_per_dropback_participation_3yr: Schema.NullOr(Schema.Finite),
  trailing_deep_route_target_share_3yr: Schema.NullOr(Schema.Finite),
  trailing_screen_route_target_share_3yr: Schema.NullOr(Schema.Finite),
  trailing_goal_line_carries_per_game_3yr: Schema.NullOr(Schema.Finite),
  trailing_goal_line_targets_per_game_3yr: Schema.NullOr(Schema.Finite),
  trailing_completion_percentage_above_expectation_3yr: Schema.NullOr(Schema.Finite),
  trailing_avg_time_to_throw_3yr: Schema.NullOr(Schema.Finite),
  trailing_avg_intended_air_yards_3yr: Schema.NullOr(Schema.Finite),
  trailing_avg_separation_3yr: Schema.NullOr(Schema.Finite),
  trailing_avg_yac_above_expectation_3yr: Schema.NullOr(Schema.Finite),
  trailing_expected_rush_points_per_game_3yr: Schema.NullOr(Schema.Finite),
  trailing_expected_tds_per_game_3yr: Schema.NullOr(Schema.Finite),
  trailing_rush_yards_over_expected_per_attempt_3yr: Schema.NullOr(Schema.Finite),
  trailing_rush_pct_over_expected_3yr: Schema.NullOr(Schema.Finite),
  history_seasons: Schema.Finite,
});
export const decodeBacktestTrainingRows = Schema.decodeUnknownSync(Schema.Array(backtestTrainingRow));

const demoByeWeekRow = Schema.Struct({
  team: Schema.String,
  bye_week: duckdbCount,
});
export const decodeDemoByeWeekRows = Schema.decodeUnknownSync(Schema.Array(demoByeWeekRow));

const demoComponentRow = Schema.Struct({
  sleeper_player_id: Schema.String,
  projected_rush_attempts: Schema.Finite,
  projected_receptions: Schema.Finite,
  history_seasons: duckdbCount,
  passing_yards: Schema.NullOr(Schema.Finite),
  passing_tds: Schema.NullOr(Schema.Finite),
  rushing_yards: Schema.NullOr(Schema.Finite),
  rushing_tds: Schema.NullOr(Schema.Finite),
  receiving_yards: Schema.NullOr(Schema.Finite),
  receiving_tds: Schema.NullOr(Schema.Finite),
});
export const decodeDemoComponentRows = Schema.decodeUnknownSync(Schema.Array(demoComponentRow));

const predictionRow = Schema.Struct({
  player_id: Schema.Union([Schema.String, Schema.BigInt]),
  player_name: Schema.String,
  position: Schema.String,
  team: Schema.String,
  base_projected_points: duckdbCount,
  usage_efficiency_adjustment: duckdbCount,
  custom_scoring_adjustment: duckdbCount,
  projected_points: duckdbCount,
  floor_projected_points: duckdbCount,
  ceiling_projected_points: duckdbCount,
  position_percentile: duckdbCount,
  value_over_replacement: duckdbCount,
  ceiling_score: duckdbCount,
  floor_score: duckdbCount,
  uncertainty_score: duckdbCount,
  injury_risk_score: duckdbCount,
  model_family: Schema.String,
});
export const decodePredictionOutputRows = Schema.decodeUnknownSync(Schema.Array(predictionRow));

const duckdbTableCount = Schema.Struct({
  table_name: Schema.String,
  row_count: Schema.BigInt,
});
export const decodeDuckDbTableCounts = Schema.decodeUnknownSync(Schema.Array(duckdbTableCount));

const profileCoverage = Schema.Struct({
  total_players: Schema.BigInt,
  with_ecr: Schema.BigInt,
  with_projection: Schema.BigInt,
  with_team_environment: Schema.BigInt,
  with_news: Schema.BigInt,
  rookies: Schema.BigInt,
  limited_experience: Schema.BigInt,
});
export const decodeProfileCoverageRows = Schema.decodeUnknownSync(Schema.Array(profileCoverage));

const profilePosition = Schema.Struct({
  position: Schema.String,
  total_players: Schema.BigInt,
  with_ecr: Schema.BigInt,
  with_projection: Schema.BigInt,
  avg_sleeper_adp: Schema.NullOr(Schema.Finite),
  avg_ecr_rank: Schema.NullOr(Schema.Finite),
});
export const decodeProfilePositionRows = Schema.decodeUnknownSync(Schema.Array(profilePosition));

const residualTrainingRow = Schema.Struct({
  season: duckdbCount, position: Schema.Literals(['QB', 'RB', 'WR', 'TE']), target_residual: duckdbCount,
  trailing_pass_attempts_per_game_3yr: Schema.NullOr(duckdbCount),
  trailing_completion_percentage_above_expectation_3yr: Schema.NullOr(duckdbCount),
  trailing_pressure_rate_3yr: Schema.NullOr(duckdbCount),
  trailing_pressure_time_to_throw_3yr: Schema.NullOr(duckdbCount),
  trailing_number_pass_rushers_3yr: Schema.NullOr(duckdbCount),
  trailing_avg_intended_air_yards_3yr: Schema.NullOr(duckdbCount),
  trailing_rush_attempts_per_game_3yr: Schema.NullOr(duckdbCount),
  trailing_offense_snap_share_3yr: Schema.NullOr(duckdbCount),
  trailing_targets_per_game_3yr: Schema.NullOr(duckdbCount),
  trailing_goal_line_carries_per_game_3yr: Schema.NullOr(duckdbCount),
  trailing_goal_line_targets_per_game_3yr: Schema.NullOr(duckdbCount),
  trailing_expected_rush_points_per_game_3yr: Schema.NullOr(duckdbCount),
  trailing_rush_yards_over_expected_per_attempt_3yr: Schema.NullOr(duckdbCount),
  trailing_rush_pct_over_expected_3yr: Schema.NullOr(duckdbCount),
  trailing_dropback_participation_per_game_3yr: Schema.NullOr(duckdbCount),
  trailing_charted_route_targets_per_game_3yr: Schema.NullOr(duckdbCount),
  trailing_target_share_3yr: Schema.NullOr(duckdbCount),
  trailing_air_yards_share_3yr: Schema.NullOr(duckdbCount),
  trailing_deep_route_target_share_3yr: Schema.NullOr(duckdbCount),
  trailing_screen_route_target_share_3yr: Schema.NullOr(duckdbCount),
  trailing_avg_separation_3yr: Schema.NullOr(duckdbCount),
  trailing_avg_yac_above_expectation_3yr: Schema.NullOr(duckdbCount),
  trailing_targets_per_dropback_participation_3yr: Schema.NullOr(duckdbCount),
  actual_points: Schema.NullOr(duckdbCount),
  actual_points_per_game: Schema.NullOr(duckdbCount),
  trailing_player_volume_3yr: Schema.NullOr(duckdbCount),
});
export const decodeResidualTrainingRows = Schema.decodeUnknownSync(Schema.Array(residualTrainingRow));
export type BacktestTrainingRow = typeof backtestTrainingRow.Type;
