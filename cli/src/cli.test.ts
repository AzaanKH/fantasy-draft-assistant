import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { DraftSyncSnapshot } from '@fantasy-draft/shared';
import { runDraft } from './run';
import { fixturePick, fixtureSettings, fixtureSnapshot, FIXTURE_NOW, writeFixtureData } from './fixtures';

const token = 't'.repeat(43);
let root: string;
let server: Server;
let baseUrl: string;
let snapshot: DraftSyncSnapshot;
let requestCount = 0;
let streamCount = 0;
let streamHandler: ((response: ServerResponse) => void) | null = null;
const connections = new Set<ServerResponse>();

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'draft-cli-'));
  await writeFixtureData(root);
  server = createServer((request, response) => {
    requestCount += 1;
    if (request.headers['x-sync-token'] !== token) { response.writeHead(403).end(); return; }
    if (['/api/sync/sleeper/drafts/fixture/refresh', '/api/sync/espn/drafts/42/refresh'].includes(request.url ?? '') && request.method === 'POST') {
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(snapshot)); return;
    }
    if (request.url === '/api/sync/sessions') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ sessions: [{ session: `${snapshot.provider}:${snapshot.draftId}`,
        provider: snapshot.provider, draftId: snapshot.draftId, draftStatus: snapshot.draft?.status ?? null,
        draftType: snapshot.draft?.type ?? null, totalTeams: snapshot.draft?.settings.teams ?? null,
        totalRounds: snapshot.draft?.settings.rounds ?? null, currentPick: snapshot.draft ? 2 : null,
        picksRecorded: snapshot.picks.length, sync: { state: snapshot.status, lastSuccessfulSyncAt: snapshot.lastSuccessfulSyncAt,
          lastError: snapshot.lastError }, lastActivityAt: FIXTURE_NOW, subscribers: 0 }] })); return;
    }
    if (request.url === '/api/sync/sleeper/drafts/fixture/events') {
      streamCount += 1;
      connections.add(response);
      response.on('close', () => connections.delete(response));
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (streamHandler) streamHandler(response);
      else response.write(`data: ${JSON.stringify({ type: 'snapshot', snapshot })}\n\n`);
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

beforeEach(async () => {
  snapshot = fixtureSnapshot(); streamHandler = null; streamCount = 0; requestCount = 0;
  await Promise.all(['cli-connections.json', 'session.json'].map(file => rm(join(root, '.local', file), { force: true })));
});
afterAll(async () => {
  for (const response of connections) response.destroy();
  server.closeAllConnections();
  await new Promise<void>(done => server.close(() => done()));
  await rm(root, { recursive: true, force: true });
});

async function command(argv: string[], overrides: { env?: NodeJS.ProcessEnv; now?: number; root?: string } = {}) {
  const stdout: string[] = []; const stderr: string[] = [];
  const code = await runDraft(argv, { stdout: text => { stdout.push(text); }, stderr: text => { stderr.push(text); } }, {
    root: overrides.root ?? root, signal: new AbortController().signal, now: () => overrides.now ?? FIXTURE_NOW,
    env: { SYNC_REQUEST_TOKEN: token, DRAFT_SLOT: '2', DRAFT_SERVER_URL: baseUrl, ...overrides.env },
  });
  return { code, stdout: stdout.join(''), stderr: stderr.join(''), result: JSON.parse(stdout.join('')) };
}

async function withSecondRoundKeeper(run: () => Promise<void>) {
  const path = join(root, 'data/league-history/current-keepers.json');
  const original = await readFile(path, 'utf8');
  const file = JSON.parse(original);
  file.keepers[1].round = 2;
  try {
    await writeFile(path, JSON.stringify(file));
    await run();
  } finally { await writeFile(path, original); }
}

describe('draft CLI against a local fixture server', () => {
  it('uses the next unreserved turn for live and replay waiting advice', async () => {
    await withSecondRoundKeeper(async () => {
      const waiting = await command(['wait', 'p3', '--session', 'fixture', '--json']);
      expect(waiting.code).toBe(0);
      expect(waiting.result.data.nextPickNumber).toBe(22);
      expect(waiting.result.data.player.timing).toMatchObject({ nextPickNumber: 22, picksUntilNextPick: 20 });
      const comparison = await command(['compare', 'p3', 'p4', '--session', 'fixture', '--json']);
      expect(comparison.code).toBe(0);
      expect(comparison.result.data.players.map((player: { timing: { nextPickNumber: number } }) => player.timing.nextPickNumber)).toEqual([22, 22]);
      const advice = await command(['recommend', '--session', 'fixture', '--json']);
      expect(advice.code).toBe(0);
      expect(advice.result.data.candidates.every((player: { timing: { nextPickNumber: number } }) => player.timing.nextPickNumber === 22)).toBe(true);
      const path = join(root, '.local/session.json');
      expect((await command(['export', '--session', 'fixture', '--out', path, '--json'])).code).toBe(0);
      const offline = await command(['wait', 'p3', '--replay', path, '--json']);
      expect(offline.code).toBe(0);
      expect(offline.result.data.nextPickNumber).toBe(22);
      expect(offline.result.data.player.timing).toEqual(waiting.result.data.player.timing);
    });
  });

  it('keeps linear reservations, turn order, corrections, and replay consistent', async () => {
    await withSecondRoundKeeper(async () => {
      snapshot = fixtureSnapshot({ draft: { ...fixtureSnapshot().draft!, type: 'linear' },
        picks: Array.from({ length: 11 }, (_, index) => fixturePick(index + 1, 100 + index, {
          draftSlot: index % 10 + 1, teamIndex: index % 10,
        })) });
      const status = await command(['status', '--session', 'fixture', '--json']);
      expect(status.code).toBe(0);
      expect(status.result.data).toMatchObject({ currentPick: 13, onTheClockSlot: 3, yourNextTurn: 22 });
      const roster = await command(['roster', '--session', 'fixture', '--json']);
      expect(roster.code).toBe(0);
      expect(roster.result.data.players).toContainEqual(expect.objectContaining({ playerId: 'p10', pickNumber: 12, source: 'keeper-reservation' }));
      const path = join(root, '.local/session.json');
      expect((await command(['export', '--session', 'fixture', '--out', path, '--json'])).code).toBe(0);
      const replay = await command(['replay', path, '--pick', '12', '--json']);
      expect(replay.code).toBe(0);
      expect(replay.result.data).toMatchObject({ currentPick: 13, yourNextTurn: 22 });
      expect(replay.result.data.rosterInspection.players).toContainEqual(expect.objectContaining({ playerId: 'p10', pickNumber: 12 }));
      snapshot = { ...snapshot, picks: [...snapshot.picks,
        fixturePick(12, 3, { draftSlot: 2, teamIndex: 1 })] };
      const corrected = await command(['players', '--session', 'fixture', '--available', '--json']);
      expect(corrected.code).toBe(0);
      expect(corrected.result.data.players).toContainEqual(expect.objectContaining({ id: 'p10', available: true }));
      const invalid = JSON.parse(await readFile(path, 'utf8'));
      invalid.data.keepers.find((keeper: { playerId: string }) => keeper.playerId === 'p10').pickNumber = 19;
      await writeFile(path, JSON.stringify(invalid));
      expect((await command(['replay', path, '--json'])).result.error.code).toBe('INVALID_ARCHIVE');
    });
  });

  it('discovers server sessions without requiring a current session', async () => {
    const result = await command(['sessions', '--json']);
    expect(result.code).toBe(0);
    expect(result.result.data.sessions).toEqual([expect.objectContaining({ session: 'sleeper:fixture',
      picksRecorded: 1, totalTeams: 10, active: false, slot: null })]);
    expect(result.stdout).not.toContain(token);
  });

  it('connects by URL and saves the session and slot for later commands', async () => {
    const connected = await command(['connect', 'https://sleeper.app/draft/nfl/fixture', '--slot', '4', '--json']);
    expect(connected.code).toBe(0);
    expect(connected.result.data).toMatchObject({ connected: true, activeSession: 'sleeper:fixture', slot: 4 });
    const config = await readFile(join(root, '.local/cli-connections.json'), 'utf8');
    expect(config).not.toContain(token);
    expect((await stat(join(root, '.local/cli-connections.json'))).mode & 0o777).toBe(0o600);
    const status = await command(['status', '--json'], { env: { DRAFT_SLOT: undefined, DRAFT_SERVER_URL: undefined } });
    expect(status.code).toBe(0);
    expect(status.result.data).toMatchObject({ session: 'sleeper:fixture', slot: 4, yourNextTurn: 4 });
    const sessions = await command(['sessions', '--json']);
    expect(sessions.result.data.sessions[0]).toMatchObject({ active: true, slot: 4 });
  });

  it('keeps saved connection settings unchanged after a failed connection', async () => {
    await command(['connect', 'fixture', '--slot', '3', '--json']);
    const path = join(root, '.local/cli-connections.json');
    const original = await readFile(path, 'utf8');
    snapshot = fixtureSnapshot({ status: 'error', lastError: 'Provider unavailable' });
    const failed = await command(['connect', 'fixture', '--slot', '4', '--json']);
    expect(failed.code).toBe(1);
    expect(failed.result.error.code).toBe('CONNECTION_FAILED');
    expect(await readFile(path, 'utf8')).toBe(original);
  });

  it('registers an ESPN session while clearly reporting the required extension observation', async () => {
    snapshot = fixtureSnapshot({ provider: 'espn', draftId: '42', draft: null, picks: [],
      status: 'idle', lastSuccessfulSyncAt: null, lastPolledAt: null });
    const result = await command(['connect', 'https://fantasy.espn.com/football/draft?leagueId=42', '--slot', '3', '--json']);
    expect(result.code).toBe(0);
    expect(result.result.data).toMatchObject({ connected: false, waitingForObservation: true,
      activeSession: 'espn:42', sync: { health: 'disconnected' } });
    expect(result.result.data.nextAction).toContain('paired extension');
  });

  it('inspects confirmed players, keeper reservations, needs, and remaining selections', async () => {
    snapshot = fixtureSnapshot({ picks: [fixturePick(1, 1), fixturePick(2, 3)] });
    const result = await command(['roster', '--session', 'fixture', '--json']);
    expect(result.code).toBe(0);
    expect(result.result.data).toMatchObject({ rosterSize: 2, confirmedCount: 1,
      keeperReservationCount: 1, selectionsRemaining: 12 });
    expect(result.result.data.players).toEqual([
      expect.objectContaining({ playerId: 'p3', source: 'provider', pickNumber: 2, isKeeper: false }),
      expect.objectContaining({ playerId: 'p10', source: 'keeper-reservation', isKeeper: true }),
    ]);
    expect(result.result.data.needs).toHaveLength(6);
  });

  it('checks local readiness without a server or pairing token and reports optional failures separately', async () => {
    const result = await command(['readiness', '--json'], { env: { SYNC_REQUEST_TOKEN: undefined } });
    expect(result.code).toBe(0);
    expect(result.result.data.readiness.status).toBe('ready');
    expect(result.result.data.readiness.optionalSignalDegradations).toHaveLength(3);
    expect(result.stderr).toBe('');
    expect(requestCount).toBe(0);
  });

  it('reports current pick, your next turn, roster reservations, and sync health', async () => {
    const result = await command(['status', '--session', 'sleeper:fixture', '--json']);
    expect(result.code).toBe(0);
    expect(result.result.data).toMatchObject({ currentPick: 2, yourNextTurn: 2, isYourTurn: true,
      onTheClockSlot: 2, sync: { health: 'healthy' }, roster: { WR: ['p10'] } });
    expect(result.stdout).not.toContain(token);
  });

  it('returns stable IDs and removes drafted players and future keepers from the filtered pool', async () => {
    const result = await command(['players', '--session', 'fixture', '--position', 'wr', '--available', '--search', 'Player', '--limit', '5', '--json']);
    expect(result.code).toBe(0);
    const players = result.result.data.players;
    expect(players).toHaveLength(5);
    expect(players.every((player: { position: string; available: boolean }) => player.position === 'WR' && player.available)).toBe(true);
    expect(players.map((player: { id: string }) => player.id)).not.toContain('p2');
    expect(players[0].id).toBe('p3');
    const all = await command(['players', '--session', 'fixture', '--search', 'Player 1', '--json']);
    expect(all.result.data.players.find((player: { id: string }) => player.id === 'p1').available).toBe(false);
  });

  it('provides Best Pick explanations and preserves ECR ordering for Best Player', async () => {
    const result = await command(['recommend', '--session', 'fixture', '--lens', 'best-pick', '--limit', '5', '--json']);
    expect(result.code).toBe(0);
    expect(result.result.data.candidates).toHaveLength(5);
    expect(result.result.data.candidates[0].decisionFactors).toBeDefined();
    expect(result.result.data.candidates[0].explanation.length).toBeGreaterThan(10);
    const quality = await command(['recommend', '--session', 'fixture', '--lens', 'best-player', '--limit', '5', '--json']);
    expect(quality.code).toBe(0);
    expect(quality.result.data.candidates[0].playerId).toBe('p3');
    expect(quality.result.data.candidates.map((candidate: { quality: { ecrRank: number } }) => candidate.quality.ecrRank)).toEqual([3, 4, 5, 6, 7]);
  });

  it('compares quality, roster fit, tiers, and timing and explains the cost of waiting', async () => {
    const comparison = await command(['compare', 'p3', 'p4', '--session', 'fixture', '--json']);
    expect(comparison.code).toBe(0);
    expect(comparison.result.data.players.map((player: { playerId: string }) => player.playerId)).toEqual(['p3', 'p4']);
    expect(comparison.result.data.players[0]).toHaveProperty('rosterFit.fixedStartersOpen');
    expect(comparison.result.data.metrics.map((metric: { key: string }) => metric.key)).toContain('returnProbability');
    const waiting = await command(['wait', 'p3', '--session', 'fixture', '--json']);
    expect(waiting.code).toBe(0);
    expect(waiting.result.data.returnProbability).toBeGreaterThanOrEqual(0);
    expect(waiting.result.data.returnProbability).toBeLessThanOrEqual(1);
    expect(waiting.result.data.nextPickNumber).toBe(19);
    expect(waiting.result.data.expectedNextPickAlternative.playerId).toBeTruthy();
    expect(waiting.result.data.answers).toHaveLength(4);
  });

  it('blocks advice for stale inputs, unconfirmed provider settings, and unresolved picks', async () => {
    const stale = await command(['recommend', '--session', 'fixture', '--json'], { now: FIXTURE_NOW + 25 * 3600_000 });
    expect(stale.code).toBe(3);
    expect(stale.result.error.code).toBe('READINESS_BLOCKED');
    snapshot = fixtureSnapshot({ draft: { ...fixtureSnapshot().draft!, leagueSettings: undefined } });
    const unconfirmed = await command(['readiness', '--session', 'fixture', '--json']);
    expect(unconfirmed.code).toBe(3);
    expect(unconfirmed.result.data.readiness.productBlockingFailures.map((item: { key: string }) => item.key)).toContain('primary-league-settings');
    snapshot = fixtureSnapshot({ picks: [fixturePick(1, 1, { playerId: 'unknown', playerName: 'Unmapped Player' })] });
    const unresolved = await command(['recommend', '--session', 'fixture', '--json']);
    expect(unresolved.code).toBe(3);
    expect(unresolved.result.error.code).toBe('PLAYER_IDENTITY_UNRESOLVED');
    const pool = await command(['players', '--session', 'fixture', '--available', '--limit', '1', '--json']);
    expect(pool.result.data.players[0].availability).toBe('unverified');
  });

  it('returns structured errors for invalid arguments, unavailable IDs, bad pairing, and mismatched snapshots', async () => {
    const missing = await command(['recommend', '--session', 'fixture', '--json'], { env: { DRAFT_SLOT: undefined } });
    expect(missing.result.error.code).toBe('SLOT_REQUIRED');
    const requestsBeforeInvalid = requestCount;
    const invalid = await command(['recommend', '--session', 'fixture', '--limit', 'five', '--json']);
    expect(invalid.code).toBe(2);
    expect(requestCount).toBe(requestsBeforeInvalid);
    expect(invalid.stderr).toBe('');
    const taken = await command(['wait', 'p2', '--session', 'fixture', '--json']);
    expect(taken.result.error.code).toBe('PLAYER_UNAVAILABLE');
    const unknown = await command(['wait', 'p9999', '--session', 'fixture', '--json']);
    expect(unknown.result.error.code).toBe('PLAYER_NOT_FOUND');
    const rejected = await command(['status', '--session', 'fixture', '--json'], { env: { SYNC_REQUEST_TOKEN: 'x'.repeat(43) } });
    expect(rejected.result.error.code).toBe('PAIRING_REJECTED');
    snapshot = fixtureSnapshot({ draftId: 'other' });
    const mismatch = await command(['status', '--session', 'fixture', '--json']);
    expect(mismatch.result.error.code).toBe('INVALID_SNAPSHOT');
  });

  it('detects keeper alias collisions without changing the keeper file', async () => {
    const path = join(root, 'data/league-history/current-keepers.json');
    const original = await readFile(path, 'utf8');
    const file = JSON.parse(original);
    file.keepers[1] = { ...file.keepers[1], playerName: 'Player 2' };
    await writeFile(path, JSON.stringify(file));
    try {
      const result = await command(['readiness', '--session', 'fixture', '--json']);
      expect(result.code).toBe(3);
      expect(result.result.data.keepers.duplicateNames).toEqual(['Player 2']);
      expect(await readFile(path, 'utf8')).toBe(JSON.stringify(file));
    } finally { await writeFile(path, original); }
  });

  it('ends recommendations when the draft completes and exposes the completed status', async () => {
    snapshot = fixtureSnapshot({ draft: { ...fixtureSnapshot().draft!, status: 'complete' } });
    const result = await command(['recommend', '--session', 'fixture', '--json']);
    expect(result.code).toBe(0);
    expect(result.result.data.candidates).toEqual([]);
    expect(result.result.data.hasRemainingDecision).toBe(false);
    const status = await command(['status', '--session', 'fixture', '--json']);
    expect(status.result.data.yourNextTurn).toBeNull();
    expect(status.result.data.currentPick).toBe(141);
  });

  it('streams NDJSON, reconnects with a fresh snapshot, and stops on cancellation', async () => {
    const controller = new AbortController();
    const output: Record<string, unknown>[] = [];
    streamHandler = response => {
      response.write(`data: ${JSON.stringify({ type: 'snapshot', snapshot: streamCount === 1 ? snapshot :
        fixtureSnapshot({ picks: [fixturePick(1, 4)] }) })}\n\n`);
      if (streamCount === 1) response.end();
    };
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const code = await runDraft(['watch', '--session', 'fixture', '--format', 'ndjson'], {
        stdout: text => { const event = JSON.parse(text); output.push(event);
          if (event.type === 'snapshot' && output.filter(row => row.type === 'snapshot').length === 2) controller.abort(); },
        stderr: text => { throw new Error(text); },
      }, { root, env: { SYNC_REQUEST_TOKEN: token, DRAFT_SERVER_URL: baseUrl },
        signal: controller.signal, now: () => FIXTURE_NOW });
      expect(code).toBe(0);
      expect(output.map(row => row.type)).toEqual(['snapshot', 'reconnecting', 'snapshot']);
      expect(output.map(row => row.sequence)).toEqual([1, 2, 3]);
      expect(output.every(row => row.schemaVersion === 1 && row.session === 'sleeper:fixture')).toBe(true);
    } finally { clearTimeout(timeout); }
  });

  it('requires provider settings even when the local saved settings are ready', async () => {
    snapshot = fixtureSnapshot({ draft: { ...fixtureSnapshot().draft!, leagueSettings: { ...fixtureSettings,
      rosterRequirements: { ...fixtureSettings.rosterRequirements, BENCH: { spots: 6 } } } } });
    const result = await command(['recommend', '--session', 'fixture', '--json']);
    expect(result.result.error.code).toBe('READINESS_BLOCKED');
  });

  it('uses the first open pick despite future provider keeper picks', async () => {
    snapshot = fixtureSnapshot({ picks: [fixturePick(1, 1), fixturePick(140, 2, {
      round: 14, draftSlot: 1, teamIndex: 0, isKeeper: true,
    })] });
    const result = await command(['status', '--session', 'fixture', '--json']);
    expect(result.result.data.currentPick).toBe(2);
    expect(result.result.data.yourNextTurn).toBe(2);
  });

  it('uses provider corrections to release displaced keeper reservations', async () => {
    snapshot = fixtureSnapshot({ picks: [fixturePick(1, 2)] });
    const pool = await command(['players', '--session', 'fixture', '--available', '--json']);
    expect(pool.result.data.players.some((player: { id: string }) => player.id === 'p1')).toBe(true);
    expect(pool.result.data.players.some((player: { id: string }) => player.id === 'p2')).toBe(false);
    const status = await command(['status', '--session', 'fixture', '--slot', '1', '--json']);
    expect(status.result.data.roster.WR).toEqual(['p2']);
  });

  it('blocks advice for unhealthy sync and reports it in connected readiness', async () => {
    snapshot = fixtureSnapshot({ status: 'error', lastError: 'Provider unavailable' });
    const readiness = await command(['readiness', '--session', 'fixture', '--json']);
    expect(readiness.code).toBe(3);
    expect(readiness.result.data.readyForAdvice).toBe(false);
    expect(readiness.result.data.blockers).toContainEqual(expect.objectContaining({ code: 'SYNC_UNHEALTHY' }));
    const advice = await command(['recommend', '--session', 'fixture', '--json']);
    expect(advice.result.error.code).toBe('SYNC_UNHEALTHY');
    const status = await command(['status', '--session', 'fixture', '--json']);
    expect(status.code).toBe(0);
    expect(status.result.data.sync.lastError).toBe('Provider unavailable');
  });

  it('does not mark malformed ranking rows ready merely because the cache has enough rows', async () => {
    const path = join(root, 'data/fantasypros-snapshot.json');
    const original = await readFile(path, 'utf8');
    const file = JSON.parse(original);
    file.rankings[0].rank = 'broken';
    await writeFile(path, JSON.stringify(file));
    try {
      const result = await command(['readiness', '--json']);
      expect(result.code).toBe(3);
      expect(result.result.data.readiness.productBlockingFailures).toContainEqual(expect.objectContaining({
        key: 'trusted-rankings', problem: 'invalid',
      }));
    } finally { await writeFile(path, original); }
  });

  it('preserves source IDs across ranking changes when a canonical join is missing', async () => {
    const files = ['data/fantasypros-snapshot.json', 'data/player-identity.json', 'data/sleeper-adp.json'];
    const originals = await Promise.all(files.map(path => readFile(join(root, path), 'utf8')));
    const [rankings, identities, sleeper] = originals.map(text => JSON.parse(text));
    identities.players = identities.players.filter((player: { canonicalId: string }) => player.canonicalId !== 'p3');
    sleeper.players = sleeper.players.filter((player: { playerId: string }) => player.playerId !== 'p3');
    try {
      await Promise.all([rankings, identities, sleeper].map((value, index) => writeFile(join(root, files[index]!), JSON.stringify(value))));
      const before = await command(['players', '--session', 'fixture', '--search', 'Player 3', '--json']);
      const findId = (result: typeof before) => result.result.data.players.find((player: { name: string }) => player.name === 'Player 3').id;
      expect(findId(before)).toBe('fantasypros:fp3');
      rankings.rankings[2].rank = 30;
      await writeFile(join(root, files[0]!), JSON.stringify(rankings));
      const after = await command(['players', '--session', 'fixture', '--search', 'Player 3', '--json']);
      expect(findId(after)).toBe(findId(before));
    } finally {
      await Promise.all(files.map((path, index) => writeFile(join(root, path), originals[index]!)));
    }
  });

  it('exports a portable archive and reproduces advice without data files, credentials, or network', async () => {
    const path = join(root, '.local/session.json');
    const exported = await command(['export', '--session', 'fixture', '--out', path, '--json']);
    expect(exported.code).toBe(0);
    expect(exported.result.data).toMatchObject({ file: path, picksRecorded: 1, playersRecorded: 350, slot: 2 });
    const content = await readFile(path, 'utf8');
    expect(JSON.parse(content)).toMatchObject({ kind: 'fantasy-draft-session', schemaVersion: 1, session: 'sleeper:fixture' });
    expect(content).not.toContain(token);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const live = await command(['recommend', '--session', 'fixture', '--json']);
    const requests = requestCount;
    const emptyRoot = await mkdtemp(join(tmpdir(), 'draft-offline-'));
    try {
      const offline = await command(['recommend', '--replay', path, '--json'], {
        root: emptyRoot, now: FIXTURE_NOW + 40 * 24 * 3600_000,
        env: { SYNC_REQUEST_TOKEN: 'invalid', DRAFT_SERVER_URL: 'https://invalid.example', DRAFT_SLOT: undefined, DRAFT_SESSION: 'espn:99' },
      });
      expect(offline.code).toBe(0);
      expect(offline.result.data.candidates).toEqual(live.result.data.candidates);
      expect(offline.result.data).toMatchObject({ source: 'replay', slot: 2, replay: { capturedAt: new Date(FIXTURE_NOW).toISOString() } });
      expect(requestCount).toBe(requests);
      expect(await readFile(path, 'utf8')).toBe(content);
    } finally { await rm(emptyRoot, { recursive: true, force: true }); }
  });

  it('refuses to overwrite exports without --force', async () => {
    const path = join(root, '.local/session.json');
    const args = ['export', '--session', 'fixture', '--out', path, '--json'];
    await command(args);
    const original = await readFile(path, 'utf8');
    snapshot = fixtureSnapshot({ picks: [fixturePick(1, 4)] });
    const refused = await command(args);
    expect(refused.code).toBe(2);
    expect(refused.result.error.code).toBe('FILE_EXISTS');
    expect(await readFile(path, 'utf8')).toBe(original);
    const replaced = await command([...args, '--force']);
    expect(replaced.code).toBe(0);
    expect(JSON.parse(await readFile(path, 'utf8')).snapshot.picks[0].playerId).toBe('p4');
  });

  it('replays earlier picks with consistent roster and availability, retaining future keepers', async () => {
    snapshot = fixtureSnapshot({ picks: [fixturePick(1, 1), fixturePick(2, 3), fixturePick(3, 4),
      fixturePick(140, 2, { round: 14, draftSlot: 1, teamIndex: 0, isKeeper: true })] });
    const path = join(root, '.local/session.json');
    await command(['export', '--session', 'fixture', '--out', path, '--json']);
    const requests = requestCount;
    const before = await command(['replay', path, '--pick', '2', '--json']);
    expect(before.code).toBe(0);
    expect(before.result.data).toMatchObject({ currentPick: 2, source: 'replay', roster: { WR: ['p10'] } });
    expect(before.result.data.snapshot.picks.map((pick: { pickNumber: number }) => pick.pickNumber)).toEqual([1, 140]);
    const pool = await command(['players', '--replay', path, '--pick', '2', '--available', '--json']);
    expect(pool.result.data.players.some((player: { id: string }) => player.id === 'p3')).toBe(true);
    expect(pool.result.data.players.some((player: { id: string }) => player.id === 'p2')).toBe(false);
    const after = await command(['roster', '--replay', path, '--pick', '3', '--json']);
    expect(after.result.data).toMatchObject({ rosterSize: 2, confirmedCount: 1 });
    const initial = await command(['recommend', '--replay', path, '--pick', '1', '--lens', 'best-player', '--json']);
    expect(initial.result.data.candidates[0].playerId).toBe('p1');
    const beyond = await command(['replay', path, '--pick', '5', '--json']);
    expect(beyond.code).toBe(2);
    expect(beyond.result.error.code).toBe('REPLAY_PICK_OUT_OF_RANGE');
    expect(requestCount).toBe(requests);
  });

  it('streams a finite replay in pick order without reconnecting or contacting the server', async () => {
    snapshot = fixtureSnapshot({ picks: [fixturePick(3, 4), fixturePick(1, 1), fixturePick(2, 3)] });
    const path = join(root, '.local/session.json');
    await command(['export', '--session', 'fixture', '--out', path, '--json']);
    const requests = requestCount;
    const output: string[] = [];
    const code = await runDraft(['replay', path, '--format', 'ndjson'], {
      stdout: text => { output.push(text); }, stderr: text => { throw new Error(text); },
    }, { root, env: {}, signal: new AbortController().signal });
    expect(code).toBe(0);
    const frames = output.map(text => JSON.parse(text));
    expect(frames.map(frame => frame.cursorPick)).toEqual([1, 2, 3, 4]);
    expect(frames.map(frame => frame.sequence)).toEqual([1, 2, 3, 4]);
    expect(frames.map(frame => frame.snapshot.picks.length)).toEqual([0, 1, 2, 3]);
    expect(frames.every(frame => frame.type === 'snapshot' && frame.source === 'replay')).toBe(true);
    expect(requestCount).toBe(requests);
  });

  it('retains recorded readiness blockers and unhealthy sync during offline replay', async () => {
    snapshot = fixtureSnapshot({ status: 'error', lastError: 'Provider unavailable' });
    const path = join(root, '.local/session.json');
    await command(['export', '--session', 'fixture', '--out', path, '--json']);
    const offline = await command(['recommend', '--replay', path, '--json']);
    expect(offline.code).toBe(3);
    expect(offline.result.error.code).toBe('SYNC_UNHEALTHY');
    const historicalReadiness = await command(['readiness', '--replay', path, '--json']);
    expect(historicalReadiness.result.data).toMatchObject({ scope: 'recorded-draft', readyForAdvice: false, source: 'replay' });
  });

  it('rejects corrupted, unsupported, or inconsistent session archives', async () => {
    const path = join(root, '.local/session.json');
    await command(['export', '--session', 'fixture', '--out', path, '--json']);
    const original = await readFile(path, 'utf8');
    const corruptions = [
      (value: Record<string, any>) => { value.schemaVersion = 99; },
      (value: Record<string, any>) => { value.session = 'sleeper:other'; },
      (value: Record<string, any>) => { value.data.players[0].projectedPoints = 'invalid'; },
      (value: Record<string, any>) => { value.snapshot.picks.push(value.snapshot.picks[0]); },
      (value: Record<string, any>) => { value.readiness.status = 'blocked'; },
    ];
    const requests = requestCount;
    for (const corrupt of corruptions) {
      const value = JSON.parse(original); corrupt(value);
      await writeFile(path, JSON.stringify(value));
      const result = await command(['replay', path, '--json']);
      expect(result.code).toBe(2);
      expect(result.result.error.code).toBe('INVALID_ARCHIVE');
    }
    expect(requestCount).toBe(requests);
  });
});
