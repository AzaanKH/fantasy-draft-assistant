/**
 * In-season retrospective of the Primary League draft: `pnpm report:season-review -- --season 2026`.
 *
 * Fetches Sleeper league, draft, matchup, transaction and weekly stat data plus the prior-season nflverse player
 * totals, joins them with the pre-draft FantasyPros snapshot and local league context, and writes JSON and markdown
 * to a gitignored directory (league data is private). See docs/season-review.md.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DuckDBInstance } from '@duckdb/node-api';
import { Clock, Data, Effect } from 'effect';
import { http } from '@fantasy-draft/shared/http';
import { currentSeason } from '@fantasy-draft/shared/league';
import { fetchJson, io, isEntryPoint, runMain, type HttpRequestError } from './effect-runtime.js';
import { buildSeasonReview } from './season-review/analysis.js';
import { parseCsv } from './season-review/core.js';
import {
  decodeContracts,
  decodeCurrentKeepers,
  decodeFantasyProsSnapshot,
  decodeHistoryEcrRows,
  decodePlayerIdentity,
  decodePredictions,
  decodePrimaryLeagueSettings,
  decodeRehearsalReport,
  decodeSleeperAdpFile,
  decodeSleeperDraft,
  decodeSleeperLeague,
  decodeSleeperMatchups,
  decodeSleeperPicks,
  decodeSleeperPlayers,
  decodeSleeperRosters,
  decodeSleeperState,
  decodeSleeperStats,
  decodeSleeperTransactions,
  decodeSleeperUsers,
  decodeSportsbook,
  type HistorySeason,
  type PriorSeasonRow,
  type SeasonReviewInputs,
} from './season-review/inputs.js';
import { renderSeasonReviewMarkdown } from './season-review/markdown.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SLEEPER = 'https://api.sleeper.app/v1';
const NFLVERSE_PLAYER_STATS = (season: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_reg_${String(season)}.csv`;
const REGULAR_SEASON_WEEKS = 18;

export class SeasonReviewError extends Data.TaggedError('SeasonReviewError')<{ readonly message: string }> {}

export interface SeasonReviewOptions {
  readonly season: number | null;
  readonly dataDir: string;
  readonly predraftFantasyPros: string | null;
  readonly currentFantasyPros: string | null;
  readonly predraftSleeper: string | null;
  readonly predraftPredictions: string | null;
  readonly historyEcr: string | null;
  readonly managerSlot: number | null;
  readonly throughWeek: number | null;
  readonly outDir: string | null;
}

const FLAGS: Readonly<Record<string, keyof SeasonReviewOptions>> = {
  '--season': 'season',
  '--data-dir': 'dataDir',
  '--predraft-fantasypros': 'predraftFantasyPros',
  '--current-fantasypros': 'currentFantasyPros',
  '--predraft-sleeper': 'predraftSleeper',
  '--predraft-predictions': 'predraftPredictions',
  '--history-ecr': 'historyEcr',
  '--manager-slot': 'managerSlot',
  '--through-week': 'throughWeek',
  '--out': 'outDir',
};
const NUMERIC: ReadonlySet<keyof SeasonReviewOptions> = new Set(['season', 'managerSlot', 'throughWeek']);

/** Parses `--flag value` pairs; a bare `--` from pnpm argument forwarding is ignored. */
export function parseSeasonReviewArgs(argv: readonly string[], cwd: string): SeasonReviewOptions {
  const options: Record<string, string | number | null> = {
    season: null, dataDir: join(REPO_ROOT, 'data'), predraftFantasyPros: null, currentFantasyPros: null, predraftSleeper: null,
    predraftPredictions: null, historyEcr: null, managerSlot: null, throughWeek: null, outDir: null,
  };
  const args = argv.filter((arg) => arg !== '--');
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index] ?? '';
    const key = FLAGS[flag];
    const value = args[index + 1];
    if (!key) throw new SeasonReviewError({ message: `Unknown option ${flag}. Options: ${Object.keys(FLAGS).join(' ')}` });
    if (value === undefined || value.startsWith('--')) throw new SeasonReviewError({ message: `${flag} needs a value` });
    if (NUMERIC.has(key)) {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) throw new SeasonReviewError({ message: `${flag} must be a positive integer` });
      options[key] = parsed;
    } else options[key] = resolve(cwd, value);
    index += 1;
  }
  const text = (key: string) => typeof options[key] === 'string' ? options[key] : null;
  const count = (key: string) => typeof options[key] === 'number' ? options[key] : null;
  return {
    season: count('season'), dataDir: text('dataDir') ?? join(REPO_ROOT, 'data'),
    predraftFantasyPros: text('predraftFantasyPros'), currentFantasyPros: text('currentFantasyPros'),
    predraftSleeper: text('predraftSleeper'), predraftPredictions: text('predraftPredictions'), historyEcr: text('historyEcr'),
    managerSlot: count('managerSlot'), throughWeek: count('throughWeek'), outDir: text('outDir'),
  };
}

/** Picks the manager's draft slot from explicit input and local evidence, refusing to guess when they disagree. */
export function resolveManagerSlot(
  explicit: number | null,
  evidence: readonly { readonly source: string; readonly slot: number }[]
): { readonly slot: number; readonly evidence: readonly string[] } {
  const described = evidence.map((item) => `${item.source}: slot ${String(item.slot)}`);
  if (explicit !== null) return { slot: explicit, evidence: [`--manager-slot ${String(explicit)}`, ...described] };
  const slots = [...new Set(evidence.map((item) => item.slot))];
  const [only] = slots;
  if (slots.length === 1 && only !== undefined) return { slot: only, evidence: described };
  throw new SeasonReviewError({
    message: slots.length === 0
      ? 'Could not identify your draft slot. Pass --manager-slot.'
      : `Draft-slot evidence disagrees (${described.join('; ')}). Pass --manager-slot.`,
  });
}

/** Last fully scored week: the latest week before Sleeper's current week whose matchups have points. */
export function lastScoredWeek(stateWeek: number, stateSeason: number, season: number, weekPoints: ReadonlyMap<number, number>): number {
  const limit = stateSeason > season ? REGULAR_SEASON_WEEKS : Math.min(REGULAR_SEASON_WEEKS, stateWeek - 1);
  for (let week = limit; week >= 1; week -= 1) if ((weekPoints.get(week) ?? 0) > 0) return week;
  return 0;
}

const toError = (cause: unknown) => cause instanceof Error ? cause : new Error(String(cause));

const readJson = <T>(path: string, decode: (value: unknown) => T) =>
  io(async () => {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    return decode(parsed);
  }).pipe(Effect.mapError((cause) => new SeasonReviewError({ message: `Could not read ${path}: ${cause.message}` })));

const readOptionalJson = <T>(path: string | null, decode: (value: unknown) => T) =>
  path && existsSync(path) ? readJson(path, decode) : Effect.succeed(null);

function fetchSleeper<T>(rawDir: string, path: string, decode: (value: unknown) => T, timeoutMs = 20_000) {
  return fetchJson(`${SLEEPER}${path}`, (value: unknown) => value, { label: 'Sleeper API', timeoutMs, retries: 2 }).pipe(
    Effect.tap((value) => io(() => writeFile(join(rawDir, `${path.replace(/^\//, '').replaceAll('/', '_')}.json`), JSON.stringify(value)))),
    Effect.flatMap((value) => Effect.try({ try: () => decode(value), catch: (cause) => new SeasonReviewError({ message: `Unexpected Sleeper ${path} payload: ${toError(cause).message}` }) })),
  );
}

const numericStats = (stats: Readonly<Record<string, Readonly<Record<string, unknown>>>>) => {
  const result: Record<string, Record<string, number>> = {};
  for (const [playerId, line] of Object.entries(stats)) {
    const numeric: Record<string, number> = {};
    for (const [key, value] of Object.entries(line)) if (typeof value === 'number' && Number.isFinite(value)) numeric[key] = value;
    result[playerId] = numeric;
  }
  return result;
};

function priorSeasonRows(csv: string): PriorSeasonRow[] {
  const [header, ...rows] = parseCsv(csv);
  if (!header) return [];
  const column = (name: string) => header.indexOf(name);
  const id = column('player_id');
  const name = column('player_display_name');
  const position = column('position');
  const team = column('recent_team');
  const games = column('games');
  const attempts = column('attempts');
  if ([id, position, team, games].some((index) => index < 0)) throw new SeasonReviewError({ message: 'nflverse player stats CSV is missing expected columns' });
  return rows.map((cells) => ({
    gsisId: cells[id] ?? '',
    name: cells[name] ?? '',
    position: cells[position] ?? '',
    team: cells[team] ?? '',
    games: Number(cells[games] ?? 0) || 0,
    passAttempts: Number(cells[attempts] ?? 0) || 0,
  })).filter((row) => row.gsisId);
}

const readHistoryEcr = (path: string | null) => path && existsSync(path)
  ? io(async () => {
    const instance = await DuckDBInstance.create(':memory:');
    const connection = await instance.connect();
    try {
      const reader = await connection.runAndReadAll(
        `select cast(season as integer) as season, cast(sleeper_player_id as varchar) as sleeper_player_id, cast(predraft_ecr as double) as predraft_ecr
         from read_parquet('${path.replaceAll("'", "''")}') where predraft_ecr is not null and sleeper_player_id is not null`);
      const rows = decodeHistoryEcrRows(reader.getRowObjectsJson());
      return new Map(rows.map((row) => [`${String(row.season)}:${row.sleeper_player_id}`, row.predraft_ecr]));
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  })
  : Effect.succeed(new Map<string, number>());

const readHistory = (dataDir: string, season: number) => io(async () => {
  const rawDir = join(dataDir, 'league-history', 'raw');
  if (!existsSync(rawDir)) return [];
  const files = await readdir(rawDir);
  const seasons = [...new Set(files.flatMap((file) => /^(\d{4})-picks\.json$/.exec(file)?.[1] ?? []))].map(Number).filter((year) => year < season).sort();
  const history: HistorySeason[] = [];
  for (const year of seasons) {
    const picks = decodeSleeperPicks(JSON.parse(await readFile(join(rawDir, `${String(year)}-picks.json`), 'utf8')));
    const usersPath = join(rawDir, `${String(year)}-users.json`);
    const users = existsSync(usersPath) ? decodeSleeperUsers(JSON.parse(await readFile(usersPath, 'utf8'))) : [];
    history.push({ season: year, teams: Math.max(...picks.map((pick) => pick.draft_slot)), picks, users });
  }
  return history;
});

const slotEvidence = (dataDir: string, draftId: string) => io(async () => {
  const evidence: { source: string; slot: number }[] = [];
  const keepersPath = join(dataDir, 'league-history', 'current-keepers.json');
  if (existsSync(keepersPath)) {
    const keepers = decodeCurrentKeepers(JSON.parse(await readFile(keepersPath, 'utf8')));
    for (const keeper of keepers.keepers) if (keeper.isMyKeeper) evidence.push({ source: `current-keepers isMyKeeper (${keeper.playerName})`, slot: keeper.team });
  }
  const rehearsalDir = join(dataDir, 'rehearsal-evidence');
  if (existsSync(rehearsalDir)) {
    for (const folder of await readdir(rehearsalDir)) {
      const reportPath = join(rehearsalDir, folder, 'report.json');
      if (!existsSync(reportPath)) continue;
      try {
        const report = decodeRehearsalReport(JSON.parse(await readFile(reportPath, 'utf8')));
        if (report.draftId === draftId && report.managerDraftSlot) evidence.push({ source: `rehearsal-evidence/${folder} managerDraftSlot`, slot: report.managerDraftSlot });
      } catch {
        // Older rehearsal reports have a different shape and carry no slot.
      }
    }
  }
  return evidence;
});

export const generateSeasonReview = (options: SeasonReviewOptions): Effect.Effect<void, SeasonReviewError | HttpRequestError | Error> => Effect.gen(function* () {
  const settings = yield* readJson(join(options.dataDir, 'primary-league-settings.json'), decodePrimaryLeagueSettings);
  const season = options.season ?? currentSeason();
  if (settings.season !== season) {
    return yield* new SeasonReviewError({ message: `primary-league-settings.json is for ${String(settings.season)}, not ${String(season)}` });
  }
  const outDir = options.outDir ?? join(REPO_ROOT, 'data', 'season-review', String(season));
  const rawDir = join(outDir, 'raw');
  yield* io(() => mkdir(rawDir, { recursive: true }));
  const predraftPath = options.predraftFantasyPros ?? join(outDir, 'inputs', 'predraft-fantasypros-snapshot.json');
  if (!existsSync(predraftPath)) {
    return yield* new SeasonReviewError({ message: `Pre-draft FantasyPros snapshot not found at ${predraftPath}. Pass --predraft-fantasypros (see docs/season-review.md).` });
  }

  const leagueId = settings.leagueId;
  const [state, league, users, rosters, draft, picks] = yield* Effect.all([
    fetchSleeper(rawDir, '/state/nfl', decodeSleeperState),
    fetchSleeper(rawDir, `/league/${leagueId}`, decodeSleeperLeague),
    fetchSleeper(rawDir, `/league/${leagueId}/users`, decodeSleeperUsers),
    fetchSleeper(rawDir, `/league/${leagueId}/rosters`, decodeSleeperRosters),
    fetchSleeper(rawDir, `/draft/${settings.draftId}`, decodeSleeperDraft),
    fetchSleeper(rawDir, `/draft/${settings.draftId}/picks`, decodeSleeperPicks),
  ], { concurrency: 3 });
  const weeks = Array.from({ length: REGULAR_SEASON_WEEKS }, (_, index) => index + 1)
    .filter((week) => Number(state.season) > season || week <= state.week);
  const matchups = yield* Effect.forEach(weeks, (week) =>
    fetchSleeper(rawDir, `/league/${leagueId}/matchups/${String(week)}`, decodeSleeperMatchups).pipe(Effect.map((rows) => ({ week, rows }))), { concurrency: 4 });
  const weekPoints = new Map(matchups.map(({ week, rows }) => [week, rows.reduce((sum, row) => sum + (row.points ?? 0), 0)]));
  const throughWeek = options.throughWeek ?? lastScoredWeek(state.week, Number(state.season), season, weekPoints);
  if (throughWeek < 1) return yield* new SeasonReviewError({ message: 'No scored weeks yet.' });
  const scoredWeeks = weeks.filter((week) => week <= throughWeek);
  const [transactions, weeklyStats, players, priorSleeper, priorCsv] = yield* Effect.all([
    Effect.forEach(scoredWeeks, (week) =>
      fetchSleeper(rawDir, `/league/${leagueId}/transactions/${String(week)}`, decodeSleeperTransactions).pipe(Effect.map((rows) => ({ week, rows }))), { concurrency: 4 }),
    Effect.forEach(scoredWeeks, (week) =>
      fetchSleeper(rawDir, `/stats/nfl/regular/${String(season)}/${String(week)}`, decodeSleeperStats, 30_000).pipe(Effect.map((stats) => ({ week, stats: numericStats(stats) }))), { concurrency: 4 }),
    fetchSleeper(rawDir, '/players/nfl', decodeSleeperPlayers, 90_000),
    fetchSleeper(rawDir, `/stats/nfl/regular/${String(season - 1)}`, decodeSleeperStats, 30_000),
    Effect.tryPromise({
      try: (signal) => http.text(NFLVERSE_PLAYER_STATS(season - 1), { timeoutMs: 60_000, retries: 2, retryAfter: true }, { init: { signal } }),
      catch: (cause) => new SeasonReviewError({ message: `nflverse player stats download failed: ${toError(cause).message}` }),
    }),
  ], { concurrency: 3 });
  yield* io(() => writeFile(join(rawDir, `nflverse_stats_player_reg_${String(season - 1)}.csv`), priorCsv));

  const evidence = yield* slotEvidence(options.dataDir, settings.draftId);
  const manager = resolveManagerSlot(options.managerSlot, evidence);
  const priorSeasonSleeperGames = new Map(Object.entries(priorSleeper).flatMap(([playerId, line]) => {
    const gp = line['gp'];
    return typeof gp === 'number' ? [[playerId, gp] as const] : [];
  }));

  const inputs: SeasonReviewInputs = {
    season,
    throughWeek,
    managerSlot: manager.slot,
    managerSlotEvidence: manager.evidence,
    league, users, rosters, draft, picks, weeklyStats, matchups, transactions, players,
    priorSeasonSleeperGames,
    priorSeasonRows: priorSeasonRows(priorCsv),
    predraftFantasyPros: yield* readJson(predraftPath, decodeFantasyProsSnapshot),
    currentFantasyPros: yield* readOptionalJson(options.currentFantasyPros ?? join(options.dataDir, 'fantasypros-snapshot.json'), decodeFantasyProsSnapshot),
    identity: yield* readOptionalJson(join(options.dataDir, 'player-identity.json'), decodePlayerIdentity),
    predraftSleeper: yield* readOptionalJson(options.predraftSleeper, decodeSleeperAdpFile),
    contracts: yield* readOptionalJson(join(options.dataDir, 'contracts.json'), decodeContracts),
    sportsbook: yield* readOptionalJson(join(options.dataDir, 'sportsbook-snapshot.json'), decodeSportsbook),
    predraftPredictions: yield* readOptionalJson(options.predraftPredictions, decodePredictions),
    history: yield* readHistory(options.dataDir, season),
    historyEcr: yield* readHistoryEcr(options.historyEcr),
  };
  const review = buildSeasonReview(inputs);
  const generatedAt = new Date(yield* Clock.currentTimeMillis).toISOString();
  const jsonPath = join(outDir, `season-review-week-${String(throughWeek)}.json`);
  const markdownPath = join(outDir, `season-review-week-${String(throughWeek)}.md`);
  yield* io(() => writeFile(jsonPath, `${JSON.stringify({ generatedAt, ...review }, null, 2)}\n`));
  yield* io(() => writeFile(markdownPath, `${renderSeasonReviewMarkdown(review)}\n_Generated ${generatedAt}._\n`));
  yield* Effect.sync(() => {
    console.log(`Season review ${review.meta.label}`);
    console.log(`  JSON:     ${jsonPath}`);
    console.log(`  Markdown: ${markdownPath}`);
  });
});

if (isEntryPoint(import.meta.url)) {
  runMain(
    Effect.suspend(() => generateSeasonReview(parseSeasonReviewArgs(process.argv.slice(2), process.env['INIT_CWD'] ?? process.cwd()))),
    'Season review failed:'
  );
}
