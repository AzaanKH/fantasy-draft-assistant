import { describe, expect, it, vi } from 'vitest';
import {
  buildSyncSnapshotUrl,
  createSyncSnapshotClient,
} from './sync-snapshot-client';

describe('sync snapshot I/O', () => {
  it('never sends a pairing token to a non-local server', async () => {
    const getToken = vi.fn(async () => 'private-test-token');
    const fetchMock = vi.fn();
    const client = createSyncSnapshotClient(async () => 'https://attacker.invalid', getToken, fetchMock);
    await expect(client.fetch({ isInDraftRoom: true, draftId: '123', provider: 'sleeper' })).rejects.toThrow('must be localhost');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getToken).not.toHaveBeenCalled();
  });

  it('does not make requests until the extension is paired', async () => {
    const fetchMock = vi.fn();
    const client = createSyncSnapshotClient(async () => 'http://localhost:3001', async () => {
      throw new Error('Pair the extension');
    }, fetchMock);
    await expect(client.fetch({ isInDraftRoom: true, draftId: '123' })).rejects.toThrow('Pair the extension');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('builds provider-aware encoded URLs', () => {
    expect(
      buildSyncSnapshotUrl('http://localhost:3001/', {
        isInDraftRoom: true,
        provider: 'yahoo',
        draftId: 'league/42',
      })
    ).toBe(
      'http://localhost:3001/api/sync/yahoo/drafts/league%2F42'
    );
  });

  it('reports non-successful HTTP responses', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 503 }));
    const client = createSyncSnapshotClient(
      async () => 'http://localhost:3001',
      async () => 'test-token',
      fetchMock
    );

    await expect(
      client.fetch({
        isInDraftRoom: true,
        provider: 'sleeper',
        draftId: '123',
      })
    ).rejects.toThrow('Snapshot request failed: 503');
  });

  it('aborts a snapshot request that never responds', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new Error('Request aborted'));
          });
        })
    );
    const client = createSyncSnapshotClient(
      async () => 'http://localhost:3001',
      async () => 'test-token',
      fetchMock,
      50
    );

    try {
      const request = client.fetch({
        isInDraftRoom: true,
        provider: 'sleeper',
        draftId: '123',
      });
      const rejection = expect(request).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(50);
      await rejection;
      expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('publishes ESPN snapshots to the browser-ingest route', async () => {
    const responseSnapshot = {
      provider: 'espn',
      draftId: '4242',
      draft: null,
      picks: [],
      status: 'synced',
      lastPolledAt: 1000,
      lastSuccessfulSyncAt: 1000,
      lastError: null,
    } as const;
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(responseSnapshot), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const client = createSyncSnapshotClient(
      async () => 'http://localhost:3001/',
      async () => 'test-token',
      fetchMock
    );

    await client.publishEspnSnapshot({
      draft: {
        provider: 'espn',
        draftId: '4242',
        providerKey: '2026:4242',
        status: 'drafting',
        type: 'snake',
        settings: { teams: 8, rounds: 16, pickTimer: 30 },
        draftOrder: null,
      },
      picks: [],
      observedAt: 1000,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/api/sync/espn/drafts/4242/snapshot',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Sync-Token': 'test-token' },
        redirect: 'error',
        body: expect.stringContaining('"provider":"espn"') as string,
      })
    );
  });
});
