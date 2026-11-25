/**
 * In-season retrospective of the Primary League draft: `pnpm report:season-review -- --season 2026`.
 *
 * Fetches Sleeper league, draft, matchup, transaction and weekly stat data plus the prior-season nflverse player
 * totals, joins them with the pre-draft FantasyPros snapshot and local league context, and writes JSON and markdown
 * to a gitignored directory (league data is private). See docs/season-review.md.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DuckDBInstance } from '@duckdb/node-api';
import { Clock, Data, Effect } from 'effect';
import { http } from '@fantasy-draft/shared/http';
import { Processes } from '@fantasy-draft/shared/node';
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
  type FantasyProsSnapshot,
  type HistorySeason,
  type PriorSeasonRow,
  type SeasonReviewInputs,
} from './season-review/inputs.js';
import { renderSeasonReviewMarkdown } from './season-review/markdown.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SLEEPER = 'https://api.sleeper.app/v1';
const NFLVERSE_PLAYER_STATS = (season: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_reg_${String(season)}.csv`;
const NFLVERSE_SCHEDULE = 'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv';
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

/** Last completed NFL week for player stats: every regular-season week once Sleeper is past the regular season. */
export function completedNflWeek(stateWeek: number, stateSeason: number, seasonType: string, season: number): number {
  if (stateSeason > season || (stateSeason === season && seasonType === 'post')) return REGULAR_SEASON_WEEKS;
  return Math.min(REGULAR_SEASON_WEEKS, stateWeek - 1);
}

/** Last regular-season week whose games, and every earlier week's, are all final in the nflverse schedule CSV. */
export function lastFinalScheduleWeek(csv: string, season: number): number {
  const [header, ...rows] = parseCsv(csv);
  const column = (name: string) => header?.indexOf(name) ?? -1;
  const [seasonAt, typeAt, weekAt, awayAt, homeAt] = ['season', 'game_type', 'week', 'away_score', 'home_score'].map(column);
  if ([seasonAt, typeAt, weekAt, awayAt, homeAt].some((index) => index === undefined || index < 0)) {
    throw new SeasonReviewError({ message: 'nflverse schedule CSV is missing expected columns' });
  }
  const at = (cells: readonly string[], index: number | undefined) => cells[index ?? -1] ?? '';
  const open = new Map<number, boolean>();
  for (const cells of rows) {
    if (Number(at(cells, seasonAt)) !== season || at(cells, typeAt) !== 'REG') continue;
    const week = Number(at(cells, weekAt));
    open.set(week, (open.get(week) ?? false) || at(cells, awayAt) === '' || at(cells, homeAt) === '');
  }
  let completed = 0;
  for (const [week, hasOpenGame] of [...open].sort(([left], [right]) => left - right)) {
    if (hasOpenGame) break;
    completed = week;
  }
  return completed;
}

/**
 * Two cutoffs. Standings, points for/against and max PF are Sleeper's live roster totals, which count only the
 * regular season: the last scored week, capped at `last_scored_leg` and the week before `playoff_week_start`. Player stats, transactions and
 * pickups may run later, through the last completed NFL week, but never earlier than standings: that would mix
 * week-N player data with later standings.
 */
export function resolveCutoffs(
  requested: number | null,
  nflCompleted: number,
  lastScored: number,
  lastScoredLeg: number | null,
  playoffWeekStart: number | null
): { readonly stats: number; readonly standings: number } {
  const standings = Math.min(lastScored, lastScoredLeg ?? lastScored, playoffWeekStart === null ? lastScored : playoffWeekStart - 1);
  if (standings < 1) throw new SeasonReviewError({ message: 'No scored weeks yet.' });
  const latest = Math.max(standings, nflCompleted);
  if (requested !== null && requested < standings) {
    throw new SeasonReviewError({
      message: `--through-week ${String(requested)} is not supported: standings are live season totals through week ${String(standings)}, so player stats cannot stop earlier.`,
    });
  }
  if (requested !== null && requested > latest) {
    throw new SeasonReviewError({ message: `--through-week ${String(requested)} is not supported: week ${String(latest)} is the last completed NFL week.` });
  }
  return { stats: requested ?? latest, standings };
}

/** Why a FantasyPros snapshot cannot stand in for pre-draft rankings, or null when it can. */
export function predraftSnapshotProblem(metadata: { readonly season: number; readonly refreshedAt: string }, season: number, draftStartMs: number): string | null {
  if (metadata.season !== season) return `is for season ${String(metadata.season)}, not ${String(season)}`;
  const refreshed = Date.parse(metadata.refreshedAt);
  if (!Number.isFinite(refreshed)) return `has an unreadable refreshedAt (${metadata.refreshedAt})`;
  if (refreshed >= draftStartMs) return `was refreshed at ${metadata.refreshedAt}, not before the draft started at ${new Date(draftStartMs).toISOString()}`;
  return null;
}

const git = (args: readonly string[], maxOutputBytes?: number) =>
  Processes.run('git', args, { timeoutMs: 60_000, ...(maxOutputBytes ? { maxOutputBytes } : {}) });

/** Latest committed `fantasypros-snapshot.json` in the data directory's git history that predates the draft. */
const predraftSnapshotFromGit = (dataDir: string, season: number, draftStartMs: number) => io(async () => {
  const path = './fantasypros-snapshot.json';
  const { stdout } = await git(['-C', dataDir, 'log', '--format=%H', '--', path]);
  for (const commit of stdout.split('\n').filter(Boolean)) {
    let snapshot: FantasyProsSnapshot;
    try {
      const shown = await git(['-C', dataDir, 'show', `${commit}:${path}`], 512 * 1024 * 1024);
      snapshot = decodeFantasyProsSnapshot(JSON.parse(shown.stdout));
    } catch {
      continue;
    }
    if (predraftSnapshotProblem(snapshot.metadata, season, draftStartMs) === null) return { snapshot, source: `git ${commit.slice(0, 7)}:${join(dataDir, 'fantasypros-snapshot.json')}` };
  }
  return null;
});

/** Real path of `path`, resolving symlinks and firmlinks through its nearest existing ancestor. */
async function realDestination(path: string): Promise<string> {
  const missing: string[] = [];
  for (let current = resolve(path); ; current = dirname(current)) {
    try {
      return join(await realpath(current), ...missing.reverse());
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code;
      if ((code !== 'ENOENT' && code !== 'ENOTDIR') || dirname(current) === current) throw cause;
      missing.push(basename(current));
    }
  }
}

/** League data is private: refuse to write any output file inside this checkout that git would let someone stage. */
export const assertPrivateOutputs = (paths: readonly string[], repoRoot: string = REPO_ROOT): Effect.Effect<void, Error> => io(async () => {
  const root = await realpath(repoRoot);
  for (const path of paths) {
    const inside = relative(root, await realDestination(path));
    if (inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) continue;
    const ignored = await git(['-C', root, 'check-ignore', '-q', '--', inside]).then(() => true, () => false);
    if (!ignored) throw new SeasonReviewError({ message: `${path} is inside the checkout but not git-ignored; private league data could be committed. Use a git-ignored --out such as data/season-review/.` });
  }
});

const toError = (cause: unknown) => cause instanceof Error ? cause : new Error(String(cause));

const readJson = <T>(path: string, decode: (value: unknown) => T) =>
  io(async () => {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    return decode(parsed);
  }).pipe(Effect.mapError((cause) => new SeasonReviewError({ message: `Could not read ${path}: ${cause.message}` })));

const readOptionalJson = <T>(path: string | null, decode: (value: unknown) => T) =>
  path && existsSync(path) ? readJson(path, decode) : Effect.succeed(null);

/** Raw provider responses, held until the output paths pass the privacy check: file name → contents. */
type RawFiles = Map<string, string>;

function fetchSleeper<T>(raw: RawFiles, path: string, decode: (value: unknown) => T, timeoutMs = 20_000) {
  return fetchJson(`${SLEEPER}${path}`, (value: unknown) => value, { label: 'Sleeper API', timeoutMs, retries: 2 }).pipe(
    Effect.tap((value) => Effect.sync(() => raw.set(`${path.replace(/^\//, '').replaceAll('/', '_')}.json`, JSON.stringify(value)))),
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
  const raw: RawFiles = new Map();
  if (options.predraftFantasyPros && !existsSync(options.predraftFantasyPros)) {
    return yield* new SeasonReviewError({ message: `Pre-draft FantasyPros snapshot not found at ${options.predraftFantasyPros}.` });
  }

  const leagueId = settings.leagueId;
  const [state, league, users, rosters, draft, picks] = yield* Effect.all([
    fetchSleeper(raw, '/state/nfl', decodeSleeperState),
    fetchSleeper(raw, `/league/${leagueId}`, decodeSleeperLeague),
    fetchSleeper(raw, `/league/${leagueId}/users`, decodeSleeperUsers),
    fetchSleeper(raw, `/league/${leagueId}/rosters`, decodeSleeperRosters),
    fetchSleeper(raw, `/draft/${settings.draftId}`, decodeSleeperDraft),
    fetchSleeper(raw, `/draft/${settings.draftId}/picks`, decodeSleeperPicks),
  ], { concurrency: 3 });
  const weeks = Array.from({ length: REGULAR_SEASON_WEEKS }, (_, index) => index + 1)
    .filter((week) => Number(state.season) > season || week <= state.week);
  const matchups = yield* Effect.forEach(weeks, (week) =>
    fetchSleeper(raw, `/league/${leagueId}/matchups/${String(week)}`, decodeSleeperMatchups).pipe(Effect.map((rows) => ({ week, rows }))), { concurrency: 4 });
  const weekPoints = new Map(matchups.map(({ week, rows }) => [week, rows.reduce((sum, row) => sum + (row.points ?? 0), 0)]));
  const lastScoredLeg = league.settings['last_scored_leg'];
  const playoffWeekStart = league.settings['playoff_week_start'];
  const schedule = yield* Effect.tryPromise({
    try: (signal) => http.text(NFLVERSE_SCHEDULE, { timeoutMs: 60_000, retries: 2, retryAfter: true }, { init: { signal } }),
    catch: (cause) => new SeasonReviewError({ message: `nflverse schedule download failed: ${toError(cause).message}` }),
  });
  // Sleeper rolls its week before Monday night ends; the schedule confirms every game of the week is final.
  const nflCompleted = Math.min(completedNflWeek(state.week, Number(state.season), state.season_type, season), lastFinalScheduleWeek(schedule, season));
  const cutoffs = yield* Effect.try({
    try: () => resolveCutoffs(options.throughWeek, nflCompleted,
      lastScoredWeek(state.week, Number(state.season), season, weekPoints), typeof lastScoredLeg === 'number' ? lastScoredLeg : null,
      typeof playoffWeekStart === 'number' ? playoffWeekStart : null),
    catch: (cause) => cause instanceof SeasonReviewError ? cause : new SeasonReviewError({ message: toError(cause).message }),
  });
  const throughWeek = cutoffs.stats;

  const draftStart = draft.start_time;
  if (draftStart === null || draftStart === undefined) return yield* new SeasonReviewError({ message: 'The Sleeper draft has no start_time to date the pre-draft snapshot against.' });
  const predraft = options.predraftFantasyPros
    ? { snapshot: yield* readJson(options.predraftFantasyPros, decodeFantasyProsSnapshot), source: options.predraftFantasyPros }
    : yield* predraftSnapshotFromGit(options.dataDir, season, draftStart);
  if (!predraft) {
    return yield* new SeasonReviewError({ message: `No committed ${join(options.dataDir, 'fantasypros-snapshot.json')} for ${String(season)} predates the draft. Pass --predraft-fantasypros (see docs/season-review.md).` });
  }
  const predraftProblem = predraftSnapshotProblem(predraft.snapshot.metadata, season, draftStart);
  if (predraftProblem) return yield* new SeasonReviewError({ message: `Pre-draft FantasyPros snapshot ${predraft.source} ${predraftProblem}.` });
  const scoredWeeks = weeks.filter((week) => week <= throughWeek);
  const [transactions, weeklyStats, players, priorSleeper, priorCsv] = yield* Effect.all([
    Effect.forEach(scoredWeeks, (week) =>
      fetchSleeper(raw, `/league/${leagueId}/transactions/${String(week)}`, decodeSleeperTransactions).pipe(Effect.map((rows) => ({ week, rows }))), { concurrency: 4 }),
    Effect.forEach(scoredWeeks, (week) =>
      fetchSleeper(raw, `/stats/nfl/regular/${String(season)}/${String(week)}`, decodeSleeperStats, 30_000).pipe(Effect.map((stats) => ({ week, stats: numericStats(stats) }))), { concurrency: 4 }),
    fetchSleeper(raw, '/players/nfl', decodeSleeperPlayers, 90_000),
    fetchSleeper(raw, `/stats/nfl/regular/${String(season - 1)}`, decodeSleeperStats, 30_000),
    Effect.tryPromise({
      try: (signal) => http.text(NFLVERSE_PLAYER_STATS(season - 1), { timeoutMs: 60_000, retries: 2, retryAfter: true }, { init: { signal } }),
      catch: (cause) => new SeasonReviewError({ message: `nflverse player stats download failed: ${toError(cause).message}` }),
    }),
  ], { concurrency: 3 });
  raw.set(`nflverse_stats_player_reg_${String(season - 1)}.csv`, priorCsv);
  const lastWeekStats = weeklyStats.find(({ week }) => week === throughWeek)?.stats ?? {};
  if (!Object.values(lastWeekStats).some((line) => (line['gp'] ?? 0) > 0)) {
    return yield* new SeasonReviewError({ message: `Sleeper has no week ${String(throughWeek)} player stats yet. Pass an earlier --through-week.` });
  }

  const evidence = yield* slotEvidence(options.dataDir, settings.draftId);
  const manager = resolveManagerSlot(options.managerSlot, evidence);
  const priorSeasonSleeperGames = new Map(Object.entries(priorSleeper).flatMap(([playerId, line]) => {
    const gp = line['gp'];
    return typeof gp === 'number' ? [[playerId, gp] as const] : [];
  }));

  const inputs: SeasonReviewInputs = {
    season,
    throughWeek,
    standingsThroughWeek: cutoffs.standings,
    managerSlot: manager.slot,
    managerSlotEvidence: manager.evidence,
    league, users, rosters, draft, picks, weeklyStats, matchups, transactions, players,
    priorSeasonSleeperGames,
    priorSeasonRows: priorSeasonRows(priorCsv),
    predraftFantasyPros: predraft.snapshot,
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
  const outputs = new Map([
    ...[...raw].map(([name, contents]) => [join(rawDir, name), contents] as const),
    [jsonPath, `${JSON.stringify({ generatedAt, ...review }, null, 2)}\n`],
    [markdownPath, `${renderSeasonReviewMarkdown(review)}\n_Generated ${generatedAt}._\n`],
  ]);
  yield* assertPrivateOutputs([...outputs.keys()]);
  yield* io(() => mkdir(rawDir, { recursive: true }));
  for (const [path, contents] of outputs) yield* io(() => writeFile(path, contents));
  yield* Effect.sync(() => {
    console.log(`Season review ${review.meta.label}`);
    console.log(`  Pre-draft rankings: ${predraft.source}`);
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
