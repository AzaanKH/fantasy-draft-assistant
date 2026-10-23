import { Schema } from 'effect';

const contractSourceColumn = Schema.Struct({
  column_name: Schema.String.check(Schema.makeFilter(value => value.length > 0)),
});
const contractRow = Schema.Struct({
  sleeper_player_id: Schema.Union([Schema.String, Schema.BigInt]),
  gsis_id: Schema.String,
  contract_end_year: Schema.Union([Schema.Finite, Schema.BigInt]),
});
const contractRelease = Schema.Struct({
  updated_at: Schema.optional(Schema.String),
  assets: Schema.optional(Schema.Array(Schema.Struct({
    name: Schema.optional(Schema.String), updated_at: Schema.optional(Schema.String),
  }))),
});

type SeasonHistoryColumn = 'season_history' | 'cols';

export const isContractSourceColumn = Schema.is(contractSourceColumn);
export const decodeContractRows = Schema.decodeUnknownSync(Schema.Array(contractRow));
export const decodeContractRelease = Schema.decodeUnknownSync(contractRelease);

export function resolveSeasonHistoryColumn(
  columnNames: readonly string[]
): SeasonHistoryColumn {
  if (columnNames.includes('season_history')) return 'season_history';
  if (columnNames.includes('cols')) return 'cols';
  throw new Error(
    'nflverse contract data has neither a season_history nor legacy cols column.'
  );
}

const dbNumber = Schema.Union([Schema.Finite, Schema.BigInt]);
const nullableDbNumber = Schema.NullOr(dbNumber);
const contractBacktestRow = Schema.Struct({
  season: dbNumber, gsis_id: Schema.String, player_name: Schema.String, position: Schema.String,
  actual_points: nullableDbNumber, age: nullableDbNumber, experience: nullableDbNumber,
  prior_points: nullableDbNumber, prior_points_per_game_3yr: nullableDbNumber,
  prior_games: nullableDbNumber, prior_opportunity_per_game: nullableDbNumber,
  prior_target_share: nullableDbNumber, is_rookie: Schema.NullOr(Schema.Boolean),
  expected_role: Schema.String, contract_known: Schema.NullOr(Schema.Boolean),
  is_contract_year: Schema.NullOr(Schema.Boolean),
});
export type ContractBacktestRow = typeof contractBacktestRow.Type;
export const decodeContractBacktestRows = Schema.decodeUnknownSync(Schema.Array(contractBacktestRow));
