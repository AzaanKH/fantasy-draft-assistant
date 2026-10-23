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
import { decodeModelReport, decodeDemoPredictions, decodeDemoByeWeekRows, decodeDemoComponentRows } from './script-file-schemas.js';
import { decodeSleeperDataFile, decodeTeamEnvDataFile, decodeRecommendationPolicyFile, decodeLeagueSurvivalModel, decodePrimaryLeagueSettingsFile } from '@fantasy-draft/shared/catalog';
import type { NFLTeam } from '@fantasy-draft/shared/league';
import { Effect } from 'effect';
import {
  anonymizeSurvivalModel,
  blendDemoRankings,
  buildDemoIdentities,
  buildDemoSnapshot,
  DEMO_LEAGUE_NAME,
  findDemoDataLeaks,
  type DemoStatHistory,
  type DemoVolume,
} from './demo-data-core.js';
import { DATA_DIR, REPO_ROOT, sqlString, withMemoryDb } from './model/duckdb.js';
import { io, runMain } from './effect-runtime.js';

const DEMO_DATA_DIR = join(REPO_ROOT, 'demo-data');
const FANTASYPROS_FREE_MODEL_DIR = join(DATA_DIR, 'model', 'fantasypros-free');
const FANTASYPROS_FREE_MODEL_DB = join(FANTASYPROS_FREE_MODEL_DIR, 'fantasy-draft.duckdb');
const NFLVERSE_SCHEDULES_URL =
  'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.parquet';

const readJson = <A>(path: string, decode: (value: unknown) => A): Effect.Effect<A, Error> =>
  io(async () => decode(JSON.parse(await readFile(path, 'utf8'))));

const serialize = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const writeFiles = (files: Readonly<Record<string, string>>): Effect.Effect<void, Error> =>
  io(async () => {
    for (const [relativePath, content] of Object.entries(files)) {
      const path = join(DEMO_DATA_DIR, relativePath);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
    }
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
    const rows = decodeDemoByeWeekRows(reader.getRowObjects());
    // nflverse uses LA for the Rams; the app uses LAR.
    return Object.fromEntries(rows.map((row) => [
      row.team === 'LA' ? 'LAR' : row.team,
      Number(row.bye_week),
    ]));
  }));

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
    const rows = decodeDemoComponentRows(reader.getRowObjects());
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
  const predictions = yield* readJson(join(FANTASYPROS_FREE_MODEL_DIR, 'predictions.json'), value => decodeDemoPredictions(value, console.warn));
  if (!predictions.modelVersion.endsWith('-fantasypros-free')) {
    return yield* Effect.fail(new Error(
      `Expected FantasyPros-free predictions; found ${predictions.modelVersion}. ` +
      'Run MODEL_SOURCE_PROFILE=fantasypros-free pnpm model:dataset first.'
    ));
  }
  const modelReport = yield* readJson(join(FANTASYPROS_FREE_MODEL_DIR, 'model-report.json'), decodeModelReport);
  const sleeper = yield* readJson(join(DATA_DIR, 'sleeper-adp.json'), value => decodeSleeperDataFile(value, { onWarning: console.warn }));
  const teamEnvironment = yield* readJson(join(DATA_DIR, 'team-environment.json'), value => decodeTeamEnvDataFile(value, { onWarning: console.warn }));
  const policy = yield* readJson(join(DATA_DIR, 'recommendation-policy.json'), decodeRecommendationPolicyFile);
  const survivalModel = yield* readJson(
    join(DATA_DIR, 'league-history', 'survival-model.json'), value => decodeLeagueSurvivalModel(value, { onWarning: console.warn })
  );
  const leagueSettings = yield* readJson(join(DATA_DIR, 'primary-league-settings.json'), decodePrimaryLeagueSettingsFile);
  const season = modelReport.currentSeason;
  const byeWeeks = yield* readByeWeeks(season);
  const { volumes, histories } = yield* readProjectionComponents(season);
  const generatedAt = predictions.generatedAt;

  const ranked = blendDemoRankings(predictions.players, sleeper.players);
  const identities = buildDemoIdentities(sleeper.players);
  const rankedIds = new Set(ranked.map((player) => player.sleeperId));
  const matchedDefenses = identities.filter((identity) =>
    identity.position === 'DEF' && rankedIds.has(identity.sleeperId)).length;

  const payloads: Readonly<Record<string, unknown>> = {
    'fantasypros-snapshot.json': buildDemoSnapshot(ranked, byeWeeks, season, generatedAt, volumes, histories),
    'player-identity.json': {
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
    },
    'predictions.json': predictions,
    'sleeper-adp.json': sleeper,
    'team-environment.json': teamEnvironment,
    'recommendation-policy.json': {
      ...policy,
      generatedAt,
      fallback: 'fantasypros-ecr-market',
      reason: 'Demo: Best Pick uses the demo ranking, roster feasibility, and draft timing.',
      // The demo has no sync server to receive shadow logs.
      shadowLogging: { enabled: false, season, endpoint: '/api/shadow-recommendations' },
    },
    'league-history/survival-model.json': anonymizeSurvivalModel(survivalModel),
    'primary-league-settings.json': {
      ...leagueSettings,
      leagueName: DEMO_LEAGUE_NAME,
      draftId: 'demo-draft',
      leagueId: 'demo-league',
    },
    // The real keeper list stays private; the demo draft starts with no keepers.
    'league-history/current-keepers.json': { updatedAt: generatedAt, season, keepers: [] },
  };

  // Check every file before writing any, so a leak never reaches demo-data/.
  const files = Object.fromEntries(
    Object.entries(payloads).map(([fileName, value]) => [fileName, serialize(value)])
  );
  const leaks = Object.entries(files).flatMap(([fileName, content]) => findDemoDataLeaks(fileName, content));
  if (leaks.length > 0) {
    return yield* Effect.fail(new Error(`Demo data failed the leak check:\n${leaks.join('\n')}`));
  }
  yield* writeFiles(files);
  console.log(`Demo data written to ${DEMO_DATA_DIR}: ${String(ranked.length)} ranked players, season ${String(season)}.`);
});

runMain(program, 'Demo data build failed:');
