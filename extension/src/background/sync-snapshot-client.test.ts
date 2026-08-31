import { describe, expect, it, vi } from 'vitest';
import {
  buildSyncSnapshotUrl,
  createSyncSnapshotClient,
} from './sync-snapshot-client';

describe('sync snapshot I/O', () => {
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
        body: expect.stringContaining('"provider":"espn"') as string,
      })
    );
  });
});
