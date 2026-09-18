import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createSyncServer, type SyncServer } from './sync-server.js';

const TOKEN = 'test-only-capability-0000000000000000000000000';
const HEADERS = { 'X-Sync-Token': TOKEN, 'Content-Type': 'application/json', Origin: 'http://localhost:3000' };
const draft = {
  provider: 'espn', draftId: '4242', providerKey: '2026:4242', status: 'drafting', type: 'snake',
  settings: { teams: 10, rounds: 16, pickTimer: 30 }, draftOrder: null,
};
const servers: SyncServer[] = [];

async function start(options: Parameters<typeof createSyncServer>[0] = {}) {
  const server = createSyncServer({ requestToken: TOKEN, fetchJson: async () => { throw new Error('No live requests'); }, ...options });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.shutdown(error => error ? reject(error) : resolve()));
  }
});

function publish(base: string, observedAt = Date.now(), changes: Record<string, unknown> = {}) {
  return fetch(`${base}/api/sync/espn/drafts/4242/snapshot`, {
    method: 'POST', headers: HEADERS,
    body: JSON.stringify({ draft, picks: [], observedAt, ...changes }),
  });
}

describe('local API security', () => {
  it('requires the capability even for trusted web and extension origins', async () => {
    const base = await start();
    for (const origin of ['http://localhost:3000', `chrome-extension://${'p'.repeat(32)}`]) {
      const denied = await fetch(`${base}/api/auth/check`, { headers: { Origin: origin } });
      expect(denied.status).toBe(403);
      const wrong = await fetch(`${base}/api/auth/check`, { headers: { Origin: origin, 'X-Sync-Token': 'wrong' } });
      expect(wrong.status).toBe(403);
      const paired = await fetch(`${base}/api/auth/check`, { headers: { Origin: origin, 'X-Sync-Token': TOKEN } });
      expect(paired.status).toBe(200);
    }
    expect((await fetch(`${base}/api/auth/check`, { headers: { ...HEADERS, Origin: 'https://attacker.invalid' } })).status).toBe(403);
    expect((await fetch(`${base}/api/auth/check`, { headers: { 'X-Sync-Token': TOKEN } })).status).toBe(200);
  });

  it('permits preflight without granting access and rejects simple content types', async () => {
    const base = await start();
    const url = `${base}/api/sync/espn/drafts/4242/snapshot`;
    expect((await fetch(url, { method: 'OPTIONS', headers: { Origin: 'http://localhost:3000' } })).status).toBe(204);
    expect((await fetch(url, { method: 'POST', headers: { ...HEADERS, 'Content-Type': 'text/plain' },
      body: JSON.stringify({ draft, picks: [], observedAt: Date.now() }) })).status).toBe(415);
    const snapshot = await fetch(`${base}/api/sync/espn/drafts/4242`, { headers: HEADERS });
    expect(await snapshot.json()).toMatchObject({ status: 'idle' });
  });

  it('rejects invalid sizes before retaining data and accepts a subsequent valid snapshot', async () => {
    const base = await start();
    for (const teams of [0, 1, 10.5, 33, 2 ** 32, null]) {
      expect((await publish(base, Date.now(), { draft: { ...draft, settings: { ...draft.settings, teams } } })).status).toBe(400);
    }
    for (const rounds of [0, 1.5, 41, 2 ** 32]) {
      expect((await publish(base, Date.now(), { draft: { ...draft, settings: { ...draft.settings, rounds } } })).status).toBe(400);
    }
    expect((await publish(base)).status).toBe(200);
  });

  it('rejects a future clock without poisoning subsequent updates, and reports stale input', async () => {
    const base = await start();
    const now = Date.now();
    expect((await publish(base, now + 365 * 86_400_000)).status).toBe(400);
    expect((await publish(base, now - 6 * 60_000)).status).toBe(400);
    expect((await publish(base, now)).status).toBe(200);
    expect((await publish(base, now - 1)).status).toBe(409);
    const accepted = await publish(base, now + 1, { draft: { ...draft, status: 'paused' } });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ draft: { status: 'paused' } });
  });

  it('allows an authenticated ESPN reset to recover from in-window clock skew', async () => {
    const base = await start();
    const now = Date.now();
    expect((await publish(base, now + 30_000)).status).toBe(200);
    expect((await publish(base, now)).status).toBe(409);
    const resetUrl = `${base}/api/sync/espn/drafts/4242/reset`;
    expect((await fetch(resetUrl, { method: 'POST' })).status).toBe(403);
    expect((await fetch(resetUrl, { method: 'POST', headers: HEADERS })).status).toBe(200);
    expect((await publish(base, now)).status).toBe(200);
  });

  it('does not allocate sessions for invalid actions, caps them, and evicts idle sessions', async () => {
    const base = await start({ limits: { maxSessions: 1, idleSessionMs: 60_000 } });
    const route = (id: number) => `${base}/api/sync/espn/drafts/${id}`;
    expect((await fetch(route(1), { method: 'POST', headers: HEADERS })).status).toBe(404);
    expect((await fetch(route(2), { headers: HEADERS })).status).toBe(200);
    expect((await fetch(route(3), { headers: HEADERS })).status).toBe(429);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_001);
    expect((await fetch(route(3), { headers: HEADERS })).status).toBe(200);
  });

  it('caps event streams while leaving ordinary requests usable', async () => {
    const base = await start({ limits: { maxClients: 2, maxClientsPerSession: 1, maxConcurrentRequests: 1 } });
    const [firstController, secondController] = [new AbortController(), new AbortController()];
    try {
      const first = await fetch(`${base}/api/sync/espn/drafts/1/events`, { headers: HEADERS, signal: firstController.signal });
      expect(first.status).toBe(200);
      expect((await fetch(`${base}/api/sync/espn/drafts/1/events`, { headers: HEADERS })).status).toBe(429);
      const second = await fetch(`${base}/api/sync/espn/drafts/2/events`, { headers: HEADERS, signal: secondController.signal });
      expect(second.status).toBe(200);
      expect((await fetch(`${base}/api/sync/espn/drafts/3/events`, { headers: HEADERS })).status).toBe(429);
      expect((await fetch(`${base}/api/auth/check`, { headers: HEADERS })).status).toBe(200);
    } finally {
      firstController.abort();
      secondController.abort();
    }
  });

  it('limits aggregate request rate', async () => {
    const base = await start({ limits: { requestsPerMinute: 2 } });
    expect((await fetch(`${base}/api/auth/check`, { headers: HEADERS })).status).toBe(200);
    expect((await fetch(`${base}/api/auth/check`, { headers: HEADERS })).status).toBe(200);
    const denied = await fetch(`${base}/api/auth/check`, { headers: HEADERS });
    expect(denied.status).toBe(429);
    expect(denied.headers.get('retry-after')).toBe('60');
  });
});
