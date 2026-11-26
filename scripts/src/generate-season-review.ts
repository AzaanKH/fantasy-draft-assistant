/**
 * In-season retrospective of the Primary League draft: `pnpm report:season-review -- --season 2026`.
 *
 * Fetches Sleeper league, draft, matchup, transaction and weekly stat data plus the prior-season nflverse player
 * totals, joins them with the pre-draft FantasyPros snapshot and local league context, and writes JSON and markdown
 * to a gitignored directory (league data is private). See docs/season-review.md.
 */
import { randomUUID } from 'node:crypto';
import { constants, existsSync } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DuckDBInstance } from '@duckdb/node-api';
import { Clock, Data, Effect, Option } from 'effect';
import { http } from '@fantasy-draft/shared/http';
import { Processes, type ProcessOptions, type ProcessResult } from '@fantasy-draft/shared/node';
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
  readonly managerRosterId: number | null;
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
  '--manager-roster-id': 'managerRosterId',
  '--through-week': 'throughWeek',
  '--out': 'outDir',
};
const NUMERIC: ReadonlySet<keyof SeasonReviewOptions> = new Set(['season', 'managerSlot', 'managerRosterId', 'throughWeek']);

/** Parses `--flag value` pairs; a bare `--` from pnpm argument forwarding is ignored. */
export function parseSeasonReviewArgs(argv: readonly string[], cwd: string): SeasonReviewOptions {
  const options: Record<string, string | number | null> = {
    season: null, dataDir: join(REPO_ROOT, 'data'), predraftFantasyPros: null, currentFantasyPros: null, predraftSleeper: null,
    predraftPredictions: null, historyEcr: null, managerSlot: null, managerRosterId: null, throughWeek: null, outDir: null,
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
    managerSlot: count('managerSlot'), managerRosterId: count('managerRosterId'), throughWeek: count('throughWeek'), outDir: text('outDir'),
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
  // Walk consecutive weeks from 1: a week missing from the schedule is not known to be final.
  let completed = 0;
  while (open.get(completed + 1) === false) completed += 1;
  return completed;
}

/**
 * Two cutoffs. Standings, points for/against and max PF are Sleeper's live roster totals, which count only the
 * regular season: the last scored week, capped at `last_scored_leg` and the week before `playoff_week_start`. Player stats, transactions and
 * pickups may run later, through the last completed NFL week, but never earlier than standings: that would mix
 * week-N player data with later standings. Live standings ahead of the last final NFL week (a week Sleeper has
 * partly scored) cannot be wound back, so that is an error until the week is final.
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
  if (standings > nflCompleted) {
    throw new SeasonReviewError({
      message: `Sleeper standings include week ${String(standings)}, but week ${String(nflCompleted)} is the last NFL week with every game final. Rerun once week ${String(standings)} is final.`,
    });
  }
  if (requested !== null && requested < standings) {
    throw new SeasonReviewError({
      message: `--through-week ${String(requested)} is not supported: standings are live season totals through week ${String(standings)}, so player stats cannot stop earlier.`,
    });
  }
  if (requested !== null && requested > nflCompleted) {
    throw new SeasonReviewError({ message: `--through-week ${String(requested)} is not supported: week ${String(nflCompleted)} is the last completed NFL week.` });
  }
  return { stats: requested ?? nflCompleted, standings };
}

/** Recovery step when Sleeper has not published player stats for the stats cutoff; never suggests a week below standings. */
export function missingStatsMessage(throughWeek: number, standingsWeek: number): string {
  const missing = `Sleeper has no week ${String(throughWeek)} player stats yet.`;
  if (throughWeek > standingsWeek) {
    return `${missing} Rerun once they are published, or pass --through-week between ${String(standingsWeek)} and ${String(throughWeek - 1)} (standings run through week ${String(standingsWeek)}).`;
  }
  return `${missing} Standings already run through week ${String(standingsWeek)}, so no earlier --through-week is valid; rerun once week ${String(throughWeek)} player stats are published.`;
}

/** A state or week marker as compared: 11 and "11" are the same week; absent and null are both no marker. */
const markerValue = (value: unknown): unknown => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return value;
};

/** Fails when Sleeper's NFL state moved while the report was reading, so standings and roster totals could span weeks. */
export function stateChangeProblem(
  before: { readonly week: number; readonly season: string; readonly season_type: string },
  after: { readonly week: number; readonly season: string; readonly season_type: string }
): string | null {
  const same = (key: 'week' | 'season' | 'season_type') => markerValue(before[key]) === markerValue(after[key]);
  if (same('week') && same('season') && same('season_type')) return null;
  return `Sleeper moved from ${before.season} ${before.season_type} week ${String(before.week)} to ${after.season} ${after.season_type} week ${String(after.week)} while the report was reading league data, so standings and roster totals may come from different weeks. Rerun the report.`;
}

const SCORED_WEEK_MARKERS = ['last_scored_leg', 'leg'] as const;

/** Fails when the league's scored-week markers moved between the league read and the re-read after rosters. */
export function leagueMarkerProblem(before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>): string | null {
  const moved = SCORED_WEEK_MARKERS.filter((key) => markerValue(before[key]) !== markerValue(after[key]));
  if (moved.length === 0) return null;
  return `Sleeper league ${moved.map((key) => `${key} moved from ${String(before[key])} to ${String(after[key])}`).join(' and ')} while the report was reading league data, so standings and roster totals may come from different weeks. Rerun the report.`;
}

/** An optional snapshot for another season would leak that season's context into this one; null keeps it. */
export function snapshotSeasonProblem(label: string, snapshotSeason: number, season: number): string | null {
  return snapshotSeason === season ? null : `${label} is for season ${String(snapshotSeason)}, not ${String(season)}; omitted from the risk analysis.`;
}

/** Why a FantasyPros snapshot cannot stand in for pre-draft rankings, or null when it can. */
export function predraftSnapshotProblem(metadata: { readonly season: number; readonly refreshedAt: string }, season: number, draftStartMs: number): string | null {
  if (metadata.season !== season) return `is for season ${String(metadata.season)}, not ${String(season)}`;
  const refreshed = Date.parse(metadata.refreshedAt);
  if (!Number.isFinite(refreshed)) return `has an unreadable refreshedAt (${metadata.refreshedAt})`;
  if (refreshed >= draftStartMs) return `was refreshed at ${metadata.refreshedAt}, not before the draft started at ${new Date(draftStartMs).toISOString()}`;
  return null;
}

const toError = (cause: unknown) => cause instanceof Error ? cause : new Error(String(cause));

const git = (args: readonly string[]) => Processes.run('git', args, { timeoutMs: 60_000 });

/**
 * A child process as an Effect: interruption stops the child's process group and completes once it has exited. A failed
 * cleanup is reported on stderr rather than failing or hanging the interruption.
 */
export const processEffect = (command: string, args: readonly string[], options: ProcessOptions): Effect.Effect<ProcessResult, Error> =>
  Effect.callback<ProcessResult, Error>((resume) => {
    const child = Processes.service(command, args, options);
    child.result.then((result) => { resume(Effect.succeed(result)); }, (cause: unknown) => { resume(Effect.fail(toError(cause))); });
    return Effect.promise(() => child.stop().catch((cause: unknown) => {
      console.error(`Stopping ${command} (pid ${String(child.pid)}) failed: ${toError(cause).message}`);
    }));
  });

const gitEffect = (args: readonly string[], maxOutputBytes?: number) =>
  processEffect('git', args, { timeoutMs: 60_000, ...(maxOutputBytes ? { maxOutputBytes } : {}) });

/** Latest committed `fantasypros-snapshot.json` in the data directory's git history that predates the draft. */
const predraftSnapshotFromGit = (dataDir: string, season: number, draftStartMs: number) => Effect.gen(function* () {
  const path = './fantasypros-snapshot.json';
  const { stdout } = yield* gitEffect(['-C', dataDir, 'log', '--format=%H', '--', path]);
  for (const commit of stdout.split('\n').filter(Boolean)) {
    // A commit whose blob cannot be read or decoded is skipped.
    const snapshot: Option.Option<FantasyProsSnapshot> = yield* gitEffect(['-C', dataDir, 'show', `${commit}:${path}`], 512 * 1024 * 1024).pipe(
      Effect.flatMap((shown) => Effect.try({ try: () => decodeFantasyProsSnapshot(JSON.parse(shown.stdout)), catch: toError })),
      Effect.option,
    );
    if (Option.isNone(snapshot)) continue;
    if (predraftSnapshotProblem(snapshot.value.metadata, season, draftStartMs) === null) {
      return { snapshot: snapshot.value, source: `git ${commit.slice(0, 7)}:${join(dataDir, 'fantasypros-snapshot.json')}` };
    }
  }
  return null;
});

const exists = (path: string) => lstat(path).then(() => true, () => false);

/** Real path of `path`, resolving symlinks through its nearest existing ancestor; a dangling symlink on the way is refused. */
async function realDestination(path: string): Promise<string> {
  const missing: string[] = [];
  for (let current = resolve(path); ; current = dirname(current)) {
    try {
      return join(await realpath(current), ...missing.reverse());
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code;
      if ((code !== 'ENOENT' && code !== 'ENOTDIR') || dirname(current) === current) throw cause;
      if (await exists(current)) throw new SeasonReviewError({ message: `${current} is a dangling symlink; refusing to write through it.` });
      missing.push(basename(current));
    }
  }
}

/**
 * `destination` relative to the checkout, or null when it is outside. The checkout is matched by device and inode,
 * not path text: macOS firmlinks give one directory two real paths (`/System/Volumes/Data/...` and `/...`).
 */
async function checkoutRelative(destination: string, root: { readonly dev: number; readonly ino: number }): Promise<string | null> {
  for (let current = destination; ; current = dirname(current)) {
    const found = await stat(current).catch(() => null);
    if (found?.dev === root.dev && found.ino === root.ino) return relative(current, destination);
    if (dirname(current) === current) return null;
  }
}

/** League data is private: refuse symlinked output files, and any output inside this checkout that git would let someone stage. */
export const assertPrivateOutputs = (paths: readonly string[], repoRoot: string = REPO_ROOT): Effect.Effect<void, Error> => io(async () => {
  const root = await stat(repoRoot);
  for (const path of paths) {
    if ((await lstat(path).catch(() => null))?.isSymbolicLink()) throw new SeasonReviewError({ message: `${path} is a symlink; refusing to write through it.` });
    const inside = await checkoutRelative(await realDestination(path), root);
    if (inside === null) continue;
    const ignored = await git(['-C', repoRoot, 'check-ignore', '-q', '--', inside]).then(() => true, () => false);
    if (!ignored) throw new SeasonReviewError({ message: `${path} is inside the checkout but not git-ignored; private league data could be committed. Use a git-ignored --out such as data/season-review/.` });
  }
});

/**
 * Writes `contents` to a new, exclusively created owner-only temp file beside `path`, then renames it over `path`.
 * The temp file holds the same private data, so it passes the same symlink and git-ignore checks first. A symlink at
 * `path` is refused; a hard link there keeps its inode and contents because rename only replaces the directory entry.
 */
const tempPathFor = (path: string) => join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);

export const writePrivateFile = (path: string, contents: string, repoRoot: string = REPO_ROOT, temp: string = tempPathFor(path)): Effect.Effect<void, Error> => Effect.gen(function* () {
  yield* assertPrivateOutputs([path, temp], repoRoot);
  yield* io(async () => {
    const handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    try {
      try {
        // The creation mode is masked by the umask; set it outright so the renamed file is 0600 whatever it replaced.
        await handle.chmod(0o600);
        await handle.writeFile(contents);
      } finally {
        await handle.close();
      }
      await rename(temp, path);
    } catch (cause) {
      await rm(temp, { force: true });
      throw cause;
    }
  });
});

/**
 * Writes every output through writePrivateFile, but only after every final and temp path has passed the privacy
 * checks, so one rejected path cannot leave some outputs freshly replaced beside stale ones.
 */
export const writePrivateOutputs = (outputs: ReadonlyMap<string, string>, repoRoot: string = REPO_ROOT): Effect.Effect<void, Error> => Effect.gen(function* () {
  const temps = new Map([...outputs.keys()].map((path) => [path, tempPathFor(path)]));
  yield* assertPrivateOutputs([...temps].flat(), repoRoot);
  for (const directory of new Set([...outputs.keys()].map((path) => dirname(path)))) yield* io(() => mkdir(directory, { recursive: true }));
  for (const [path, contents] of outputs) yield* writePrivateFile(path, contents, repoRoot, temps.get(path));
});

const readJson = <T>(path: string, decode: (value: unknown) => T) =>
  io(async () => {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    return decode(parsed);
  }).pipe(Effect.mapError((cause) => new SeasonReviewError({ message: `Could not read ${path}: ${cause.message}` })));

/** A default artifact that may be absent: null when the file does not exist. */
const readOptionalJson = <T>(path: string, decode: (value: unknown) => T) =>
  existsSync(path) ? readJson(path, decode) : Effect.succeed(null);

/** An explicitly supplied option must name a readable file; an omitted option falls back to `fallback`. */
const readExplicitOr = <T>(explicit: string | null, decode: (value: unknown) => T, fallback: Effect.Effect<T | null, SeasonReviewError>) =>
  explicit ? readJson(explicit, decode) : fallback;

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

const readHistoryEcr = (path: string | null) => path
  ? io(async () => {
    if (!existsSync(path)) throw new SeasonReviewError({ message: `--history-ecr file not found at ${path}` });
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

export const slotEvidence = (dataDir: string, draftId: string, season: number): Effect.Effect<{ source: string; slot: number }[], Error> => io(async () => {
  const evidence: { source: string; slot: number }[] = [];
  const keepersPath = join(dataDir, 'league-history', 'current-keepers.json');
  if (existsSync(keepersPath)) {
    const keepers = decodeCurrentKeepers(JSON.parse(await readFile(keepersPath, 'utf8')));
    // Another season's keepers say nothing about this draft's slot.
    if (keepers.season === season) for (const keeper of keepers.keepers) if (keeper.isMyKeeper) evidence.push({ source: `current-keepers isMyKeeper (${keeper.playerName})`, slot: keeper.team });
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
  // Order matters: the NFL state and the league's scored-week markers are read before the mutable roster and matchup
  // data, and both are read again after it, so any roll in between is caught.
  const state = yield* fetchSleeper(raw, '/state/nfl', decodeSleeperState);
  const [league, users, draft, picks] = yield* Effect.all([
    fetchSleeper(raw, `/league/${leagueId}`, decodeSleeperLeague),
    fetchSleeper(raw, `/league/${leagueId}/users`, decodeSleeperUsers),
    fetchSleeper(raw, `/draft/${settings.draftId}`, decodeSleeperDraft),
    fetchSleeper(raw, `/draft/${settings.draftId}/picks`, decodeSleeperPicks),
  ], { concurrency: 3 });
  const rosters = yield* fetchSleeper(raw, `/league/${leagueId}/rosters`, decodeSleeperRosters);
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
    return yield* new SeasonReviewError({ message: missingStatsMessage(throughWeek, cutoffs.standings) });
  }
  // Rosters, matchups, transactions and stats were read after the first state and league reads; confirm neither moved meanwhile.
  const [stateAfter, leagueAfter] = yield* Effect.all([
    fetchSleeper(new Map(), '/state/nfl', decodeSleeperState),
    fetchSleeper(new Map(), `/league/${leagueId}`, decodeSleeperLeague),
  ]);
  const stateProblem = stateChangeProblem(state, stateAfter) ?? leagueMarkerProblem(league.settings, leagueAfter.settings);
  if (stateProblem) return yield* new SeasonReviewError({ message: stateProblem });

  const evidence = yield* slotEvidence(options.dataDir, settings.draftId, season);
  const manager = resolveManagerSlot(options.managerSlot, evidence);
  const priorSeasonSleeperGames = new Map(Object.entries(priorSleeper).flatMap(([playerId, line]) => {
    const gp = line['gp'];
    return typeof gp === 'number' ? [[playerId, gp] as const] : [];
  }));

  const omittedInputs: string[] = [];
  const contracts = yield* readOptionalJson(join(options.dataDir, 'contracts.json'), decodeContracts);
  const contractsProblem = contracts ? snapshotSeasonProblem('contracts.json', contracts.contractYear, season) : null;
  if (contractsProblem) omittedInputs.push(contractsProblem);
  const sportsbook = yield* readOptionalJson(join(options.dataDir, 'sportsbook-snapshot.json'), decodeSportsbook);
  const sportsbookProblem = sportsbook ? snapshotSeasonProblem('sportsbook-snapshot.json', sportsbook.metadata.season, season) : null;
  if (sportsbookProblem) omittedInputs.push(sportsbookProblem);

  const inputs: SeasonReviewInputs = {
    season,
    throughWeek,
    standingsThroughWeek: cutoffs.standings,
    managerSlot: manager.slot,
    managerSlotEvidence: manager.evidence,
    managerRosterIdOption: options.managerRosterId,
    league, users, rosters, draft, picks, weeklyStats, matchups, transactions, players,
    priorSeasonSleeperGames,
    priorSeasonRows: priorSeasonRows(priorCsv),
    predraftFantasyPros: predraft.snapshot,
    currentFantasyPros: yield* readExplicitOr(options.currentFantasyPros, decodeFantasyProsSnapshot,
      readOptionalJson(join(options.dataDir, 'fantasypros-snapshot.json'), decodeFantasyProsSnapshot)),
    identity: yield* readOptionalJson(join(options.dataDir, 'player-identity.json'), decodePlayerIdentity),
    predraftSleeper: yield* readExplicitOr(options.predraftSleeper, decodeSleeperAdpFile, Effect.succeed(null)),
    contracts: contractsProblem ? null : contracts,
    sportsbook: sportsbookProblem ? null : sportsbook,
    omittedInputs,
    predraftPredictions: yield* readExplicitOr(options.predraftPredictions, decodePredictions, Effect.succeed(null)),
    history: yield* readHistory(options.dataDir, season),
    historyEcr: yield* readHistoryEcr(options.historyEcr),
  };
  const review = yield* Effect.try({
    try: () => buildSeasonReview(inputs),
    catch: (cause) => new SeasonReviewError({ message: toError(cause).message }),
  });
  const generatedAt = new Date(yield* Clock.currentTimeMillis).toISOString();
  const jsonPath = join(outDir, `season-review-week-${String(throughWeek)}.json`);
  const markdownPath = join(outDir, `season-review-week-${String(throughWeek)}.md`);
  const outputs = new Map([
    ...[...raw].map(([name, contents]) => [join(rawDir, name), contents] as const),
    [jsonPath, `${JSON.stringify({ generatedAt, ...review }, null, 2)}\n`],
    [markdownPath, `${renderSeasonReviewMarkdown(review)}\n_Generated ${generatedAt}._\n`],
  ]);
  yield* writePrivateOutputs(outputs);
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
