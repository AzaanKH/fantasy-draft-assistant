import { describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { draftFixture, picksFixture } from './__fixtures__/sleeper-fixtures.js';
import { createSyncServer, SLEEPER_API_BASE, type FetchJson } from './sync-server.js';
import type { DraftSyncSnapshot } from '@fantasy-draft/shared';

function createMockFetchJson(): FetchJson {
  return async <T>(url: string): Promise<T> => {
    if (url === `${SLEEPER_API_BASE}/draft/fixture-draft`) {
      return draftFixture as T;
    }

    if (url === `${SLEEPER_API_BASE}/draft/fixture-draft/picks`) {
      return picksFixture as T;
    }

    throw new Error(`Unexpected URL: ${url}`);
  };
}

describe('createSyncServer', () => {
  it('returns a normalized draft snapshot from mocked Sleeper responses', async () => {
    const server = createSyncServer({
      fetchJson: createMockFetchJson(),
      pollIntervalMs: 60_000,
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/sync/drafts/fixture-draft`, {
        headers: { Origin: 'http://localhost:3000' },
      });
      expect(response.ok).toBe(true);

      const snapshot = (await response.json()) as DraftSyncSnapshot;

      expect(snapshot.draft?.draft_id).toBe(draftFixture.draft_id);
      expect(snapshot.picks).toHaveLength(3);
      expect(snapshot.picks[0]?.playerName).toBe('Christian McCaffrey');
      expect(snapshot.picks[2]?.position).toBe('TE');
      expect(snapshot.status).toBe('synced');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.shutdown((error?: Error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });

  it('serves health checks', async () => {
    const server = createSyncServer({
      fetchJson: createMockFetchJson(),
      pollIntervalMs: 60_000,
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(response.ok).toBe(true);
      expect(await response.json()).toEqual({ ok: true });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.shutdown((error?: Error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });

  it('rejects unauthorized draft requests before fetching Sleeper', async () => {
    let fetchCalls = 0;
    const server = createSyncServer({
      fetchJson: async <T>(): Promise<T> => {
        fetchCalls += 1;
        return draftFixture as T;
      },
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/sync/drafts/fixture-draft`, {
        headers: { Origin: 'https://untrusted.example' },
      });

      expect(response.status).toBe(403);
      expect(fetchCalls).toBe(0);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.shutdown((error?: Error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });

  it('times out stalled Sleeper requests and clears the sync state', async () => {
    const server = createSyncServer({
      requestTimeoutMs: 5,
      fetchJson: <T>(_url: string, signal: AbortSignal) => new Promise<T>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('Sleeper request timed out')));
      }),
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/sync/drafts/fixture-draft`, {
        headers: { Origin: 'http://localhost:3000' },
      });
      const snapshot = (await response.json()) as DraftSyncSnapshot;

      expect(snapshot.status).toBe('error');
      expect(snapshot.lastError).toBe('Sleeper request timed out');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.shutdown((error?: Error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });
});
