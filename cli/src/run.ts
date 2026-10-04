import { resolve } from 'node:path';
import { Cause, Effect, Exit, Result, Stream } from 'effect';
import { createDefaultLeagueSettings, type DraftReadinessReport, type Recommendation } from '@fantasy-draft/shared';
import { buildDraftReadinessReport } from '../../scripts/src/draft-readiness-report';
import { createDraftDecisionOutput } from '@/features/recommendations/draft-decision';
import { getComparisonHighlights, getAvailabilitySignal, getWaitAnswer } from '@/features/assistant/assistant-analysis';
import { getComparisonMetrics } from '@/features/assistant/comparison-metrics';
import { SAFE_RECOMMENDATION_POLICY } from '@/lib/player-data/policy';
import { invocationMode, parseArguments, parseSession, HELP, type Arguments, type SessionId } from './arguments';
import { DraftClient, readPairingToken } from './client';
import { loadDraftData, loadJson, resolveKeepers, type DraftData } from './data';
import { connectedSettings, createSessionContext, withConnectedReadiness, withLocalKeeperReadiness, replaceCoreReadiness, requireAdvice, adviceBoard, type SessionContext } from './context';
import { attempt, CliError, required, unexpected } from './errors';
import { EMPTY_CONNECTIONS, loadConnections, saveConnection } from './connections';
import { archivedData, createArchive, readArchive, replayBoundaries, replaySnapshot, saveArchive, type SessionArchive } from './archive';
import { inspectRoster } from './roster';

export interface Output {
  stdout: (text: string) => void | Promise<void>;
  stderr: (text: string) => void | Promise<void>;
}
export interface Runtime {
  readonly root: string;
  readonly env: NodeJS.ProcessEnv;
  readonly signal: AbortSignal;
  readonly now?: () => number;
}

function envelope(command: string, data: unknown) { return { schemaVersion: 1, command, data }; }

function statusData(context: SessionContext, session: string, warnings: readonly string[]) {
  const snapshot = context.snapshot;
  return { session, provider: snapshot.provider, draftId: snapshot.draftId,
    draftStatus: snapshot.draft?.status ?? null, draftType: snapshot.draft?.type ?? null,
    totalTeams: context.totalTeams || null, totalRounds: context.totalRounds || null,
    currentPick: context.currentPick, onTheClockSlot: context.onTheClockSlot,
    slot: context.slot, yourNextTurn: context.nextTurn, isYourTurn: context.isMyTurn,
    picksRecorded: snapshot.picks.length, sync: context.sync, roster: context.slot === null ? null : context.roster,
    unresolvedPicks: context.unresolvedPicks, warnings: [...warnings, ...(context.slot === null
      ? ['Set --slot, DRAFT_SLOT, or connect with --slot to see your next turn and roster.'] : [])] };
}
function markInvalidCoreData(report: DraftReadinessReport, error: unknown): DraftReadinessReport {
  if (!(error instanceof CliError) || error.code !== 'CORE_DATA_INVALID') return report;
  const keys = (error.details as { invalidCoreKeys: readonly string[] }).invalidCoreKeys;
  return replaceCoreReadiness(report, report.coreDraftData.filter(item => keys.includes(item.key)).map(item => ({
    ...item, status: 'blocking', problem: 'invalid', message: error.message,
  })));
}
function playerSummary(recommendation: Recommendation) {
  const factors = recommendation.decisionFactors;
  const diagnostics = recommendation.diagnostics;
  return {
    ...recommendation,
    quality: factors?.playerQuality ?? { ecrRank: diagnostics?.expertRank ?? null },
    rosterFit: factors?.rosterFit ?? null,
    tier: factors?.tierSupply ?? { currentTier: diagnostics?.tier ?? null },
    timing: factors?.draftTiming ?? { returnProbability: diagnostics?.nextPickSurvivalProbability ?? null },
  };
}

const write = (output: Output['stdout'], text: string) => Effect.promise(async () => { await output(text); });

// These failures will repeat on every attempt, so reconnecting would only hide them.
const FATAL_STREAM_ERRORS = new Set(['PAIRING_REJECTED', 'INVALID_STREAM', 'SERVER_ERROR']);

const watch = Effect.fn('watch')(function* (session: SessionId, client: DraftClient, io: Output, now: () => number) {
  let sequence = 0;
  let failures = 0;
  const emit = (event: object) => write(io.stdout, `${JSON.stringify({ schemaVersion: 1, command: 'watch',
    session: session.id, sequence: ++sequence, receivedAt: new Date(now()).toISOString(), ...event })}\n`);
  for (;;) {
    yield* client.events(session).pipe(
      Stream.runForEach(update => { failures = 0; return emit(update); }),
      Effect.catchIf(error => !FATAL_STREAM_ERRORS.has(error.code), () => Effect.void),
    );
    const retryInMs = Math.min(30_000, 1000 * 2 ** Math.min(failures++, 5));
    yield* emit({ type: 'reconnecting', retryInMs });
    yield* Effect.sleep(retryInMs);
  }
});

const buildReadiness = (now: number, root: string) => Effect.tryPromise({
  try: () => buildDraftReadinessReport(now, root), catch: unexpected,
});

const execute = Effect.fn('execute')(function* (args: Arguments, client: DraftClient | null, runtime: Runtime) {
  let now = (runtime.now ?? Date.now)();
  const root = resolve(runtime.root);
  if (args.command === 'sessions') {
    const [sessions, saved] = yield* Effect.all([required(client, 'server client').sessions(), loadConnections(root)],
      { concurrency: 'unbounded' });
    return { data: { serverUrl: args.serverUrl, total: sessions.length,
      activeSession: saved.activeSession, sessions: sessions.map(session => {
        const connection = saved.connections.find(row => row.session === session.session && row.serverUrl === args.serverUrl);
        return { ...session, slot: connection?.slot ?? null,
          active: session.session === saved.activeSession && connection !== undefined };
      }) }, exitCode: 0 };
  }
  if (args.command === 'readiness' && !args.session && !args.replayFile) {
    let readiness = yield* buildReadiness(now, root);
    let data: DraftData | null = null;
    const warnings: string[] = [];
    const loaded = yield* Effect.result(loadDraftData(root, createDefaultLeagueSettings(now), 14));
    if (Result.isSuccess(loaded)) {
      data = loaded.success;
      readiness = withLocalKeeperReadiness(readiness, data, now);
    } else {
      readiness = markInvalidCoreData(readiness, loaded.failure);
      warnings.push(loaded.failure.message);
    }
    return { data: { scope: 'local-data', readyForAdvice: null, readiness,
      settings: yield* loadJson(root, 'data/primary-league-settings.json'),
      keepers: data ? { ...data.keeperStatus, error: data.keeperStatus.error?.message ?? null } : null,
      warnings }, exitCode: readiness.status === 'blocked' ? 3 : 0 };
  }
  let archive: SessionArchive | null = null;
  if (args.replayFile) {
    archive = yield* readArchive(args.replayFile);
    now = Date.parse(archive.capturedAt);
    args = { ...args, session: parseSession(archive.session), slot: args.slot ?? archive.slot ?? undefined };
  }
  const session = required(args.session, 'draft session');
  const replay = archive;
  const snapshot = replay ? yield* attempt(() => replaySnapshot(replay, args.pick)) : yield* required(client, 'server client').snapshot(session);
  const settings = connectedSettings(snapshot, now);
  const rounds = snapshot.draft?.settings.rounds ?? 14;
  const warnings: string[] = [...(archive?.warnings ?? [])];
  let data: DraftData | null = archive ? archivedData(archive) : null;
  let localReadiness = archive?.readiness ?? (['status', 'connect'].includes(args.command) ? null : yield* buildReadiness(now, root));
  const needsMarket = !archive && ['players', 'recommend', 'compare', 'wait', 'roster', 'export'].includes(args.command);
  const market = needsMarket ? yield* required(client, 'server client').marketAdp(settings, new Date(now).getUTCFullYear()) : { players: [] };
  if (market.warning) warnings.push(market.warning);
  if (!archive) {
    const loaded = yield* Effect.result(loadDraftData(root, settings, rounds, market.players, snapshot.draft?.type));
    if (Result.isSuccess(loaded)) data = loaded.success;
    else {
      const error = loaded.failure;
      if (!['status', 'readiness', 'connect'].includes(args.command)) {
        return yield* new CliError(error.code, error.message, error.exitCode, { readiness: localReadiness });
      }
      if (localReadiness) localReadiness = markInvalidCoreData(localReadiness, error);
      warnings.push(error.message);
    }
  }
  const slot = args.slot;
  const context = yield* attempt(() => createSessionContext(snapshot, data, slot, now));
  const origin = archive ? { source: 'replay', replay: { file: resolve(required(args.replayFile, 'replay file')),
    capturedAt: archive.capturedAt, requestedPick: args.pick ?? null } } : { source: 'live' };
  if (args.command === 'connect') {
    const waitingForObservation = session.provider === 'espn' && snapshot.draft === null;
    if (!waitingForObservation && (snapshot.draft === null || context.sync.health !== 'healthy')) {
      return yield* new CliError('CONNECTION_FAILED', 'The provider draft could not be connected. Check the draft ID and provider availability.', 1, { sync: context.sync });
    }
    const configFile = yield* saveConnection(root, session, args.slot, args.serverUrl, now);
    return { data: { ...statusData(context, session.id, warnings), ...origin,
      connected: !waitingForObservation, waitingForObservation, activeSession: session.id, configFile,
      ...(waitingForObservation ? { nextAction: 'Keep the signed-in ESPN draft tab open with the paired extension to provide draft observations.' } : {}) }, exitCode: 0 };
  }
  if (args.command === 'status') {
    return { data: { ...statusData(context, session.id, warnings), ...origin }, exitCode: 0 };
  }
  // A missing player pool must still produce a connected readiness report with actionable failures.
  const readinessData = data ?? { players: [], keepers: [], keeperStatus: resolveKeepers(null, [], settings.totalTeams, rounds).status,
    survivalModel: null, policy: SAFE_RECOMMENDATION_POLICY };
  const readiness = withConnectedReadiness(required(localReadiness, 'readiness report'), snapshot, readinessData, now);
  if (args.command === 'readiness') {
    const blockers = [
      ...(context.sync.health !== 'healthy' ? [{ code: 'SYNC_UNHEALTHY', message: 'Restore provider synchronization before using advice.' }] : []),
      ...(context.unresolvedPicks.length > 0 ? [{ code: 'PLAYER_IDENTITY_UNRESOLVED', message: 'Refresh canonical identities to resolve provider picks.' }] : []),
      ...(snapshot.draft?.type !== 'snake' ? [{ code: 'UNSUPPORTED_DRAFT_TYPE', message: 'Advice currently supports snake drafts.' }] : []),
    ];
    const readyForAdvice = readiness.status === 'ready' && blockers.length === 0;
    return { data: { scope: archive ? 'recorded-draft' : 'connected-draft', ...origin, session: session.id, readyForAdvice, readiness, blockers,
      settings: snapshot.draft?.leagueSettings ?? null,
      keepers: { ...readinessData.keeperStatus, error: readinessData.keeperStatus.error?.message ?? null },
      sync: context.sync, warnings }, exitCode: readyForAdvice ? 0 : 3 };
  }
  if (!snapshot.draft) return yield* new CliError('SESSION_NOT_READY', 'The draft has no provider metadata yet. Check draft status and restore the provider connection.');
  // Commands past this point rethrow player-data failures above, so the pool is always loaded.
  const pool = required(data, 'player data');
  if (args.command === 'export') {
    const file = resolve(required(args.outputFile, 'output file'));
    const saved = createArchive(snapshot, pool, readiness, args.slot, warnings, now);
    yield* saveArchive(file, saved, args.force);
    return { data: { ...origin, session: session.id, file, capturedAt: saved.capturedAt,
      currentPick: context.currentPick, picksRecorded: snapshot.picks.length, playersRecorded: pool.players.length,
      slot: args.slot ?? null, readinessStatus: readiness.status }, exitCode: 0 };
  }
  if (args.command === 'replay') {
    return { data: { ...statusData(context, session.id, warnings), ...origin,
      snapshot, readiness, ...(context.slot === null ? {} : { rosterInspection: yield* attempt(() => inspectRoster(context, pool)) }) }, exitCode: 0 };
  }
  if (args.command === 'roster') {
    return { data: { session: session.id, ...origin, currentPick: context.currentPick,
      sync: context.sync, readiness, warnings, ...yield* attempt(() => inspectRoster(context, pool)) }, exitCode: 0 };
  }
  if (args.command === 'players') {
    let players = [...(args.available ? context.availablePlayers : pool.players)];
    if (args.position) players = players.filter(player => player.position === args.position);
    if (args.search) {
      const query = args.search.toLowerCase();
      players = players.filter(player => `${player.name} ${player.team} ${player.id}`.toLowerCase().includes(query));
    }
    players.sort((left, right) => left.ecrRank - right.ecrRank || left.id.localeCompare(right.id));
    const total = players.length;
    if (args.limit) players = players.slice(0, args.limit);
    return { data: { session: session.id, ...origin, total, returned: players.length,
      filters: { position: args.position ?? null, available: args.available, search: args.search ?? null },
      players: players.map(player => ({ ...player, available: !context.draftedIds.has(player.id),
        availability: context.unresolvedPicks.length > 0 ? 'unverified' : context.draftedIds.has(player.id) ? 'taken' : 'available' })),
      readiness, unresolvedPicks: context.unresolvedPicks, warnings }, exitCode: 0 };
  }
  yield* attempt(() => { requireAdvice(context, readiness); });
  const board = adviceBoard(context, pool);
  const decision = createDraftDecisionOutput(board.recommendations.draftNow, board.recommendations.selection,
    board.recommendations.bestAvailable, args.lens);
  const recommendations = decision.selectedView.recommendations;
  const common = { session: session.id, ...origin, slot: context.slot, currentPick: context.currentPick,
    yourNextTurn: context.nextTurn, lens: args.lens, sync: context.sync, readiness, warnings };
  if (args.command === 'recommend') {
    return { data: { ...common, hasRemainingDecision: board.hasDecision,
      bestPick: decision.bestPick, bestPlayer: decision.bestPlayer,
      decisionDivergence: decision.decisionDivergence,
      decisionDivergenceFactor: decision.decisionDivergenceFactor,
      decisionDivergenceExplanation: decision.decisionDivergenceExplanation,
      candidates: recommendations.slice(0, args.limit ?? 5).map((recommendation, index) => ({
        rank: index + 1, ...playerSummary(recommendation),
        explanation: decision.selectedView.explanationByPlayerId.get(recommendation.playerId) ?? recommendation.reason,
      })), needs: board.needs }, exitCode: 0 };
  }
  if (!board.hasDecision) return yield* new CliError('NO_REMAINING_PICK', 'You have no draft selection remaining.');
  const find = (id: string): Effect.Effect<Recommendation, CliError> => {
    if (!pool.players.some(player => player.id === id)) return Effect.fail(new CliError('PLAYER_NOT_FOUND', `Unknown player ID ${id}. Use draft players to find stable IDs.`, 2));
    if (context.draftedIds.has(id)) return Effect.fail(new CliError('PLAYER_UNAVAILABLE', `Player ${id} is drafted or reserved as a keeper.`, 2));
    const recommendation = recommendations.find(candidate => candidate.playerId === id);
    if (!recommendation) return Effect.fail(new CliError('PLAYER_INELIGIBLE', `Player ${id} cannot fill a remaining roster slot under this decision lens.`, 2));
    return Effect.succeed(recommendation);
  };
  const first = yield* find(required(args.playerIds[0], 'player ID'));
  if (args.command === 'compare') {
    const second = yield* find(required(args.playerIds[1], 'second player ID'));
    const firstRank = required(decision.selectedView.rankByPlayerId.get(first.playerId), 'player rank');
    const secondRank = required(decision.selectedView.rankByPlayerId.get(second.playerId), 'player rank');
    return { data: { ...common, players: [playerSummary(first), playerSummary(second)],
      preferredPlayerId: firstRank <= secondRank ? first.playerId : second.playerId,
      metrics: getComparisonMetrics(first, second, decision.selectedView.rankByPlayerId),
      highlights: getComparisonHighlights(first, second, decision.selectedView) }, exitCode: 0 };
  }
  const timing = first.decisionFactors?.draftTiming;
  const returnProbability = timing?.returnProbability ?? first.diagnostics?.nextPickSurvivalProbability ?? null;
  const nextPickNumber = timing?.nextPickNumber ?? first.diagnostics?.nextPickNumber ?? null;
  return { data: { ...common, player: playerSummary(first),
    returnProbability, nextPickNumber,
    waitingAssessment: nextPickNumber === null ? 'No later selection remains.' :
      getAvailabilitySignal(returnProbability === null ? null : Math.round(returnProbability * 100)).status,
    expectedNextPickAlternative: timing?.expectedAlternative ?? first.diagnostics?.expectedNextPickAlternative ?? null,
    costOfWaiting: timing?.costOfWaiting ?? first.diagnostics?.nextPickCostOfWaiting ?? null,
    // Same answer as the Assistant's Can I wait? tab.
    answerHeadline: getWaitAnswer(first).headline,
    answers: getWaitAnswer(first).rows }, exitCode: 0 };
});

const replayStream = Effect.fn('replayStream')(function* (replayFile: string, pick: number | undefined, io: Output) {
  const archive = yield* readArchive(replayFile);
  const boundaries = pick === undefined ? yield* attempt(() => replayBoundaries(archive)) : [pick];
  let sequence = 0;
  for (const cursorPick of boundaries) {
    const snapshot = yield* attempt(() => replaySnapshot(archive, cursorPick));
    yield* write(io.stdout, `${JSON.stringify({ schemaVersion: 1, command: 'replay', session: archive.session,
      sequence: ++sequence, source: 'replay', capturedAt: archive.capturedAt, cursorPick,
      type: 'snapshot', snapshot })}\n`);
  }
});

export async function runDraft(argv: readonly string[], io: Output, runtime: Runtime): Promise<number> {
  let command: string | null = argv[0] ?? null;
  // JSON errors stay on stdout, including parser and connection failures.
  const machineOutput = argv.includes('--json') || argv.includes('--format=ndjson') ||
    argv.includes('ndjson') || argv[0] === 'watch';
  const program = Effect.gen(function* () {
    const mode = yield* attempt(() => invocationMode(argv));
    const connections = mode === 'live' ? yield* loadConnections(runtime.root) : EMPTY_CONNECTIONS;
    const args = yield* attempt(() => parseArguments(argv, runtime.env,
      { session: connections.activeSession ?? undefined, connections: connections.connections }));
    if (!args) { yield* write(io.stdout, HELP); return 0; }
    command = args.command;
    const token = !args.replayFile && (args.session || args.command === 'sessions') ? yield* readPairingToken(runtime.root, runtime.env) : null;
    const client = token ? new DraftClient(args.serverUrl, token) : null;
    if (args.command === 'watch') {
      return yield* watch(required(args.session, 'draft session'), required(client, 'server client'), io, runtime.now ?? Date.now);
    }
    if (args.command === 'replay' && args.format === 'ndjson') {
      yield* replayStream(required(args.replayFile, 'replay file'), args.pick, io);
      return 0;
    }
    const result = yield* execute(args, client, runtime);
    if (args.json) yield* write(io.stdout, `${JSON.stringify(envelope(args.command, result.data))}\n`);
    else yield* write(io.stdout, `${renderText(args.command, result.data)}\n`);
    return result.exitCode;
  }).pipe(Effect.catchCause(cause => {
    if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
    const error = Cause.squash(cause);
    const failure = error instanceof CliError ? error : unexpected(error);
    return write(machineOutput ? io.stdout : io.stderr, machineOutput
      ? `${JSON.stringify({ schemaVersion: 1, command, error: { code: failure.code, message: failure.message,
        ...(failure.details === undefined ? {} : { details: failure.details }) } })}\n`
      : `${failure.code}: ${failure.message}\n`).pipe(Effect.as(failure.exitCode));
  }));
  const exit = await Effect.runPromiseExit(program, { signal: runtime.signal });
  // Stopping the command, by signal or a closed output pipe, is a clean exit.
  return Exit.isSuccess(exit) && !runtime.signal.aborted ? exit.value : 0;
}

function renderText(command: string, value: unknown): string {
  // The same result is available without --json, with indentation for terminal inspection.
  return `${command}\n${JSON.stringify(value, null, 2)}`;
}
