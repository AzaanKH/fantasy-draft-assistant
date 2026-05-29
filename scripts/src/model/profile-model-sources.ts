/**
 * Profiles the local DuckDB model sources and writes a compact JSON report.
 *
 * Usage: pnpm --filter scripts model:profile
 */

import { writeFile } from 'node:fs/promises';
import {
  MODEL_PATHS,
  connectModelDb,
} from './duckdb.js';

interface CountRow {
  readonly table_name: string;
  readonly row_count: bigint;
}

interface CoverageRow {
  readonly total_players: bigint;
  readonly with_ecr: bigint;
  readonly with_projection: bigint;
  readonly with_team_environment: bigint;
  readonly with_news: bigint;
  readonly rookies: bigint;
  readonly limited_experience: bigint;
}

interface PositionRow {
  readonly position: string;
  readonly total_players: bigint;
  readonly with_ecr: bigint;
  readonly with_projection: bigint;
  readonly avg_sleeper_adp: number | null;
  readonly avg_ecr_rank: number | null;
}

function asNumber(value: bigint | number | null): number | null {
  if (value === null) return null;
  return Number(value);
}

async function main(): Promise<void> {
  const connection = await connectModelDb();

  try {
    const countsReader = await connection.runAndReadAll(`
      select 'sleeper_adp_current' as table_name, count(*) as row_count from model.sleeper_adp_current
      union all
      select 'fantasypros_rankings_current', count(*) from model.fantasypros_rankings_current
      union all
      select 'fantasypros_projections_current', count(*) from model.fantasypros_projections_current
      union all
      select 'fantasypros_news_current', count(*) from model.fantasypros_news_current
      union all
      select 'team_environment_current', count(*) from model.team_environment_current
      union all
      select 'current_player_join', count(*) from model.current_player_join
    `);
    const coverageReader = await connection.runAndReadAll(`
      select
        count(*) as total_players,
        count(ecr_rank) as with_ecr,
        count(projected_points) as with_projection,
        count(offense_score) as with_team_environment,
        count(news_status) as with_news,
        count(*) filter (where missing_history_reason = 'rookie') as rookies,
        count(*) filter (where missing_history_reason = 'limited_experience') as limited_experience
      from model.current_player_join
    `);
    const positionReader = await connection.runAndReadAll(`
      select
        position,
        count(*) as total_players,
        count(ecr_rank) as with_ecr,
        count(projected_points) as with_projection,
        round(avg(sleeper_adp), 2) as avg_sleeper_adp,
        round(avg(ecr_rank), 2) as avg_ecr_rank
      from model.current_player_join
      group by position
      order by total_players desc, position
    `);
    const unmatchedReader = await connection.runAndReadAll(`
      select sleeper_player_id, player_name, position, team, sleeper_adp
      from model.current_player_join
      where ecr_rank is null
      order by sleeper_adp nulls last
      limit 25
    `);

    const coverage = coverageReader.getRowObjects()[0] as CoverageRow | undefined;
    const report = {
      generatedAt: new Date().toISOString(),
      source: 'data/model/fantasy-draft.duckdb',
      tables: (countsReader.getRowObjects() as unknown as CountRow[]).map((row) => ({
        tableName: row.table_name,
        rowCount: Number(row.row_count),
      })),
      coverage: coverage
        ? {
            totalPlayers: Number(coverage.total_players),
            withEcr: Number(coverage.with_ecr),
            withProjection: Number(coverage.with_projection),
            withTeamEnvironment: Number(coverage.with_team_environment),
            withNews: Number(coverage.with_news),
            rookies: Number(coverage.rookies),
            limitedExperience: Number(coverage.limited_experience),
          }
        : null,
      byPosition: (positionReader.getRowObjects() as unknown as PositionRow[]).map((row) => ({
        position: row.position,
        totalPlayers: Number(row.total_players),
        withEcr: Number(row.with_ecr),
        withProjection: Number(row.with_projection),
        avgSleeperAdp: asNumber(row.avg_sleeper_adp),
        avgEcrRank: asNumber(row.avg_ecr_rank),
      })),
      topUnmatchedByAdp: unmatchedReader.getRowObjects(),
    };

    await writeFile(MODEL_PATHS.profileReportJson, JSON.stringify(report, null, 2));
    console.log(`Profile report written to ${MODEL_PATHS.profileReportJson}`);
    console.log(JSON.stringify(report.coverage, null, 2));
  } finally {
    connection.closeSync();
  }
}

main().catch((error: unknown) => {
  console.error('Model profiling failed:', error);
  process.exit(1);
});
