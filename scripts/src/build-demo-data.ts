/**
 * Builds the publishable demo dataset in demo-data/ from local, untracked data.
 *
 * Run the FantasyPros-free model first:
 *   MODEL_SOURCE_PROFILE=fantasypros-free pnpm model:dataset
 *
 * Usage: pnpm data:demo:build
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { NFLTeam } from '@fantasy-draft/shared';
import { Effect } from 'effect';
import {
  anonymizeSurvivalModel,
  blendDemoRankings,
  buildDemoIdentities,
  buildDemoSnapshot,
  DEMO_LEAGUE_NAME,
  findDemoDataLeaks,
  type DemoPredictionPlayer,
  type DemoSleeperPlayer,
  type DemoStatHistory,
  type DemoVolume,
} from './demo-data-core.js';
import { DATA_DIR, REPO_ROOT, sqlString, withMemoryDb } from './model/duckdb.js';
import { io, runMain } from './effect-runtime.js';

export const DEMO_DATA_DIR = join(REPO_ROOT, 'demo-data');
const FANTASYPROS_FREE_MODEL_DIR = join(DATA_DIR, 'model', 'fantasypros-free');
const FANTASYPROS_FREE_MODEL_DB = join(FANTASYPROS_FREE_MODEL_DIR, 'fantasy-draft.duckdb');
const NFLVERSE_SCHEDULES_URL =
  'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.parquet';

interface PredictionsFile {
  readonly generatedAt: string;
  readonly modelVersion: string;
  readonly players: readonly DemoPredictionPlayer[];
}

interface ModelReportFile {
  readonly currentSeason: number;
}

interface SleeperFile {
  readonly fetchedAt: string;
  readonly players: readonly DemoSleeperPlayer[];
}

interface ByeWeekRow {
  readonly team: string;
  readonly bye_week: number | bigint;
}

const readJson = <T>(path: string): Effect.Effect<T, Error> =>
  io(async () => JSON.parse(await readFile(path, 'utf8')) as T);

const writeJson = (relativePath: string, value: unknown): Effect.Effect<string, Error> =>
  io(async () => {
    const path = join(DEMO_DATA_DIR, relativePath);
    await mkdir(dirname(path), { recursive: true });
    const content = `${JSON.stringify(value, null, 2)}\n`;
    await writeFile(path, content);
    return content;
  });

/** Bye weeks are the regular-season weeks a team does not play, from nflverse's schedule. */
const readByeWeeks = (season: number): Effect.Effect<Partial<Record<NFLTeam, number>>, Error> =>
  withMemoryDb((connection) => io(async () => {
    const reader = await connection.runAndReadAll(`
      with games as (
        select week, home_team as team from read_parquet(${sqlString(NFLVERSE_SCHEDULES_URL)})
        where season = ${String(season)} and game_type = 'REG'
        union all
        select week, away_team from read_parquet(${sqlString(NFLVERSE_SCHEDULES_URL)})
        where season = ${String(season)} and game_type = 'REG'
      ),
      weeks as (select distinct week from games),
      teams as (select distinct team from games)
      select teams.team, min(weeks.week) as bye_week
      from teams cross join weeks
      where not exists (
        select 1 from games where games.team = teams.team and games.week = weeks.week
      )
      group by teams.team
    `);
    const rows = reader.getRowObjects() as unknown as ByeWeekRow[];
    // nflverse uses LA for the Rams; the app uses LAR.
    return Object.fromEntries(rows.map((row) => [
      row.team === 'LA' ? 'LAR' : row.team,
      Number(row.bye_week),
    ])) as Partial<Record<NFLTeam, number>>;
  }));

interface ComponentRow {
  readonly sleeper_player_id: string;
  readonly projected_rush_attempts: number;
  readonly projected_receptions: number;
  readonly history_seasons: number | bigint;
  readonly passing_yards: number | null;
  readonly passing_tds: number | null;
  readonly rushing_yards: number | null;
  readonly rushing_tds: number | null;
  readonly receiving_yards: number | null;
  readonly receiving_tds: number | null;
}

interface ProjectionComponents {
  readonly volumes: ReadonlyMap<string, DemoVolume>;
  readonly histories: ReadonlyMap<string, DemoStatHistory>;
}

/**
 * Reads the model's projected receptions and rush attempts and each player's
 * per-game yards and touchdowns over the three seasons before this one.
 */
const readProjectionComponents = (season: number): Effect.Effect<ProjectionComponents, Error> =>
  withMemoryDb((connection) => io(async () => {
    await connection.run(`attach ${sqlString(FANTASYPROS_FREE_MODEL_DB)} as free (read_only)`);
    const perGame = (column: string): string => `avg(${column} / games) as ${column}`;
    const reader = await connection.runAndReadAll(`
      with history as (
        select
          player_id,
          count(*) as history_seasons,
          ${['passing_yards', 'passing_tds', 'rushing_yards', 'rushing_tds', 'receiving_yards', 'receiving_tds']
            .map(perGame).join(',\n          ')}
        from free.source.nflverse_player_stats
        where season_type = 'REG' and games > 0
          and season between ${String(season - 3)} and ${String(season - 1)}
        group by player_id
      )
      select distinct on (features.sleeper_player_id)
        features.sleeper_player_id,
        features.projected_rush_attempts,
        features.projected_receptions,
        coalesce(history.history_seasons, 0) as history_seasons,
        history.* exclude (player_id, history_seasons)
      from free.model.shared_prediction_features features
      left join history on history.player_id = features.gsis_id
      where features.sleeper_player_id is not null
    `);
    await connection.run('detach free');
    const rows = reader.getRowObjects() as unknown as ComponentRow[];
    return {
      volumes: new Map(rows.map((row) => [row.sleeper_player_id, {
        projectedRushAttempts: row.projected_rush_attempts,
        projectedReceptions: row.projected_receptions,
      }])),
      histories: new Map(rows.flatMap((row) => Number(row.history_seasons) === 0 ? [] : [[
        row.sleeper_player_id,
        {
          passingYards: row.passing_yards ?? 0,
          passingTouchdowns: row.passing_tds ?? 0,
          rushingYards: row.rushing_yards ?? 0,
          rushingTouchdowns: row.rushing_tds ?? 0,
          receivingYards: row.receiving_yards ?? 0,
          receivingTouchdowns: row.receiving_tds ?? 0,
        },
      ] as const])),
    };
  }));

const program = Effect.gen(function* () {
  const predictions = yield* readJson<PredictionsFile>(join(FANTASYPROS_FREE_MODEL_DIR, 'predictions.json'));
  if (!predictions.modelVersion.endsWith('-fantasypros-free')) {
    return yield* Effect.fail(new Error(
      `Expected FantasyPros-free predictions; found ${predictions.modelVersion}. ` +
      'Run MODEL_SOURCE_PROFILE=fantasypros-free pnpm model:dataset first.'
    ));
  }
  const modelReport = yield* readJson<ModelReportFile>(join(FANTASYPROS_FREE_MODEL_DIR, 'model-report.json'));
  const sleeper = yield* readJson<SleeperFile>(join(DATA_DIR, 'sleeper-adp.json'));
  const teamEnvironment = yield* readJson<unknown>(join(DATA_DIR, 'team-environment.json'));
  const policy = yield* readJson<Record<string, unknown>>(join(DATA_DIR, 'recommendation-policy.json'));
  const survivalModel = yield* readJson<Parameters<typeof anonymizeSurvivalModel>[0]>(
    join(DATA_DIR, 'league-history', 'survival-model.json')
  );
  const leagueSettings = yield* readJson<Record<string, unknown>>(join(DATA_DIR, 'primary-league-settings.json'));
  const season = modelReport.currentSeason;
  const byeWeeks = yield* readByeWeeks(season);
  const { volumes, histories } = yield* readProjectionComponents(season);
  const generatedAt = predictions.generatedAt;

  const ranked = blendDemoRankings(predictions.players, sleeper.players);
  const identities = buildDemoIdentities(sleeper.players);
  const rankedIds = new Set(ranked.map((player) => player.sleeperId));
  const matchedDefenses = identities.filter((identity) =>
    identity.position === 'DEF' && rankedIds.has(identity.sleeperId)).length;

  const written = yield* Effect.all([
    writeJson('fantasypros-snapshot.json', buildDemoSnapshot(ranked, byeWeeks, season, generatedAt, volumes, histories)),
    writeJson('player-identity.json', {
      generatedAt,
      season,
      sources: { demoRankingsGeneratedAt: generatedAt, sleeperFetchedAt: sleeper.fetchedAt },
      coverage: {
        fantasyProsRankings: ranked.length,
        matchedFantasyProsRankings: ranked.length,
        fantasyProsRankingMatchRate: 1,
        matchedDefenses,
        sleeperPlayers: sleeper.players.length,
        identityRecords: identities.length,
      },
      players: identities,
    }),
    writeJson('predictions.json', predictions),
    writeJson('sleeper-adp.json', sleeper),
    writeJson('team-environment.json', teamEnvironment),
    writeJson('recommendation-policy.json', {
      ...policy,
      generatedAt,
      fallback: 'fantasypros-ecr-market',
      reason: 'Demo: Best Pick uses the demo ranking, roster feasibility, and draft timing.',
      // The demo has no sync server to receive shadow logs.
      shadowLogging: { enabled: false, season, endpoint: '/api/shadow-recommendations' },
    }),
    writeJson('league-history/survival-model.json', anonymizeSurvivalModel(survivalModel)),
    writeJson('primary-league-settings.json', {
      ...leagueSettings,
      leagueName: DEMO_LEAGUE_NAME,
      draftId: 'demo-draft',
      leagueId: 'demo-league',
    }),
    // The real keeper list stays private; the demo draft starts with no keepers.
    writeJson('league-history/current-keepers.json', { updatedAt: generatedAt, season, keepers: [] }),
  ]);

  const fileNames = [
    'fantasypros-snapshot.json', 'player-identity.json', 'predictions.json', 'sleeper-adp.json',
    'team-environment.json', 'recommendation-policy.json', 'league-history/survival-model.json',
    'primary-league-settings.json', 'league-history/current-keepers.json',
  ];
  const leaks = written.flatMap((content, index) => findDemoDataLeaks(fileNames[index] ?? '', content));
  if (leaks.length > 0) {
    return yield* Effect.fail(new Error(`Demo data failed the leak check:\n${leaks.join('\n')}`));
  }
  console.log(`Demo data written to ${DEMO_DATA_DIR}: ${String(ranked.length)} ranked players, season ${String(season)}.`);
});

runMain(program, 'Demo data build failed:');
