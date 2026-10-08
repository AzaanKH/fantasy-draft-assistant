/**
 * Initializes the local DuckDB modeling workspace from the runtime JSON cache.
 *
 * Usage: pnpm --filter scripts model:duckdb:init
 */

import { Effect } from 'effect';
import {
  EXCLUDES_FANTASYPROS,
  MODEL_DB_PATH,
  MODEL_PATHS,
  withModelDb,
  ensureModelDirs,
  readJsonFile,
  runStatements,
  sqlString,
} from './duckdb.js';
import { io, runMain } from '../effect-runtime.js';

interface ContractsJson {
  readonly players?: readonly unknown[];
}

interface TeamEnvironmentJson {
  readonly teams: Record<
    string,
    {
      readonly team: string;
      readonly name: string;
      readonly offenseScore: number;
      readonly passVolume: string;
      readonly rushVolume: string;
      readonly pointsRank: number;
      readonly passAttemptsRank: number;
      readonly rushAttemptsRank: number;
      readonly coachingStability: boolean;
    }
  >;
}

const normalizeNameSql = (column: string): string =>
  `regexp_replace(lower(${column}), '[^a-z0-9]', '', 'g')`;

/**
 * Builds a FantasyPros table from the snapshot, or an empty table with the same
 * columns when the FantasyPros-free profile must not read it.
 */
function fantasyProsTable(
  table: string,
  snapshotField: string,
  alias: string,
  columns: readonly (readonly [expression: string, name: string, type: string])[]
): string {
  if (EXCLUDES_FANTASYPROS) {
    return `create or replace table ${table} (
          ${columns.map(([, name, type]) => `${name} ${type}`).join(',\n          ')}
        )`;
  }
  return `create or replace table ${table} as
        select
          ${columns.map(([expression, name]) => `${expression} as ${name}`).join(',\n          ')}
        from (
          select unnest(${snapshotField}) as ${alias}
          from read_json_auto(${sqlString(MODEL_PATHS.fantasyProsSnapshotJson)})
        )`;
}

const program = Effect.gen(function* () {
  yield* io(() => ensureModelDirs());

  const contracts = yield* io(() => readJsonFile<ContractsJson>(MODEL_PATHS.contractsJson));
  const teamEnvironment = yield* io(() => readJsonFile<TeamEnvironmentJson>(MODEL_PATHS.teamEnvironmentJson));
  const hasContracts = (contracts.players?.length ?? 0) > 0;
  const teamEnvironmentValues = (
    Object.values(teamEnvironment.teams)
  )
    .map(
      (team) =>
        `(${[
          sqlString(team.team),
          sqlString(team.name),
          team.offenseScore,
          sqlString(team.passVolume),
          sqlString(team.rushVolume),
          team.pointsRank,
          team.passAttemptsRank,
          team.rushAttemptsRank,
          team.coachingStability,
        ].join(', ')})`
    )
    .join(',\n          ');
  yield* withModelDb((connection) => io(async () => {
    await runStatements(connection, [
      `create schema if not exists model`,
      `create or replace table model.sleeper_adp_current as
        select
          p.playerId::varchar as sleeper_player_id,
          p.name::varchar as player_name,
          ${normalizeNameSql('p.name')} as normalized_name,
          p.position::varchar as position,
          p.team::varchar as team,
          case
            when not isfinite(p.sleeperAdp::double)
              or p.sleeperAdp::double <= 0
              or p.sleeperAdp::double >= 999 then null
            else p.sleeperAdp::double
          end as sleeper_adp,
          p.age::double as age,
          p.yearsExp::double as years_experience,
          p.status::varchar as status
        from (
          select unnest(players) as p
          from read_json_auto(${sqlString(MODEL_PATHS.sleeperAdpJson)})
        )`,
      fantasyProsTable('model.fantasypros_rankings_current', 'rankings', 'r', [
        ['r.rank::integer', 'ecr_rank', 'integer'],
        ['r.name::varchar', 'player_name', 'varchar'],
        [normalizeNameSql('r.name'), 'normalized_name', 'varchar'],
        ['r.position::varchar', 'position', 'varchar'],
        ['r.team::varchar', 'team', 'varchar'],
        ['r.byeWeek::integer', 'bye_week', 'integer'],
        ['r.positionalRank::integer', 'positional_rank', 'integer'],
        ['r.bestRank::integer', 'best_rank', 'integer'],
        ['r.worstRank::integer', 'worst_rank', 'integer'],
        ['r.avgRank::double', 'avg_rank', 'double'],
      ]),
      fantasyProsTable('model.fantasypros_adp_current', 'adp', 'a', [
        ['a.rank::double', 'consensus_adp', 'double'],
        ['a.name::varchar', 'player_name', 'varchar'],
        [normalizeNameSql('a.name'), 'normalized_name', 'varchar'],
        ['a.position::varchar', 'position', 'varchar'],
        ['a.team::varchar', 'team', 'varchar'],
        ['a.positionalRank::integer', 'positional_adp', 'integer'],
      ]),
      fantasyProsTable('model.fantasypros_projections_current', 'projections', 'p', [
        ['p.name::varchar', 'player_name', 'varchar'],
        [normalizeNameSql('p.name'), 'normalized_name', 'varchar'],
        ['p.position::varchar', 'position', 'varchar'],
        ['p.team::varchar', 'team', 'varchar'],
        ['p.projectedPoints::double', 'projected_points', 'double'],
        ['null::double', 'floor_points', 'double'],
        ['null::double', 'ceiling_points', 'double'],
      ]),
      fantasyProsTable('model.fantasypros_news_current', 'news', 'n', [
        ['n.name::varchar', 'player_name', 'varchar'],
        [normalizeNameSql('n.name'), 'normalized_name', 'varchar'],
        ['n.position::varchar', 'position', 'varchar'],
        ['n.team::varchar', 'team', 'varchar'],
        ['n.status::varchar', 'news_status', 'varchar'],
        ['n.headline::varchar', 'headline', 'varchar'],
        ['n.updatedAt::timestamp', 'updated_at', 'timestamp'],
      ]),
      `create or replace table model.team_environment_current as
        select
          team::varchar as team,
          team_name::varchar as team_name,
          offense_score::double as offense_score,
          pass_volume::varchar as pass_volume,
          rush_volume::varchar as rush_volume,
          points_rank::integer as points_rank,
          pass_attempts_rank::integer as pass_attempts_rank,
          rush_attempts_rank::integer as rush_attempts_rank,
          coaching_stability::boolean as coaching_stability
        from (
          values
          ${teamEnvironmentValues}
        ) as teams(
          team,
          team_name,
          offense_score,
          pass_volume,
          rush_volume,
          points_rank,
          pass_attempts_rank,
          rush_attempts_rank,
          coaching_stability
        )`,
      hasContracts
        ? `create or replace table model.contracts_current as
            select
              c.name::varchar as player_name,
              ${normalizeNameSql('c.name')} as normalized_name,
              c.position::varchar as position,
              c.team::varchar as team,
              c.contractEndYear::integer as contract_end_year,
              c.isContractYear::boolean as is_contract_year
            from (
              select unnest(players) as c
              from read_json_auto(${sqlString(MODEL_PATHS.contractsJson)})
            )`
        : `create or replace table model.contracts_current (
            player_name varchar,
            normalized_name varchar,
            position varchar,
            team varchar,
            contract_end_year integer,
            is_contract_year boolean
          )`,
      `create or replace table model.current_player_join as
        select
          s.sleeper_player_id,
          coalesce(s.player_name, r.player_name, p.player_name) as player_name,
          coalesce(s.position, r.position, p.position) as position,
          coalesce(s.team, r.team, p.team) as team,
          s.sleeper_adp,
          a.consensus_adp,
          s.age,
          s.years_experience,
          s.status,
          r.ecr_rank,
          r.positional_rank,
          r.best_rank,
          r.worst_rank,
          r.avg_rank,
          p.projected_points,
          p.floor_points,
          p.ceiling_points,
          n.news_status,
          n.headline,
          c.contract_end_year,
          coalesce(c.is_contract_year, false) as is_contract_year,
          te.offense_score,
          te.pass_volume,
          te.rush_volume,
          te.points_rank,
          te.pass_attempts_rank,
          te.rush_attempts_rank,
          te.coaching_stability,
          case
            when s.years_experience is null then 'source_gap'
            when s.years_experience = 0 then 'rookie'
            when s.years_experience <= 2 then 'limited_experience'
            else null
          end as missing_history_reason
        from model.sleeper_adp_current s
        left join model.fantasypros_rankings_current r
          on s.normalized_name = r.normalized_name
          and s.position = r.position
          and s.team = r.team
        left join model.fantasypros_adp_current a
          on s.normalized_name = a.normalized_name
          and s.position = a.position
          and s.team = a.team
        left join model.fantasypros_projections_current p
          on s.normalized_name = p.normalized_name
          and s.position = p.position
          and s.team = p.team
        left join model.fantasypros_news_current n
          on s.normalized_name = n.normalized_name
          and s.position = n.position
          and s.team = n.team
        left join model.contracts_current c
          on s.normalized_name = c.normalized_name
          and s.position = c.position
          and s.team = c.team
        left join model.team_environment_current te
          on s.team = te.team`,
      `copy model.current_player_join
        to ${sqlString(MODEL_PATHS.normalizedPlayersParquet)}
        (format parquet, compression zstd)`,
    ]);

    console.log(`DuckDB initialized at ${MODEL_DB_PATH}`);
    console.log(`Normalized current-player join written to ${MODEL_PATHS.normalizedPlayersParquet}`);
  }));
});

runMain(program, 'DuckDB initialization failed:');
