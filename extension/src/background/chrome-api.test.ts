import type {
  DraftProvider,
  DraftSyncSnapshot,
  EspnDraftSnapshot,
} from '@fantasy-draft/shared';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type {
  DetectedPick,
  DraftRoomStatus,
  ExtensionMessage,
  MessageResponse,
} from '../shared/types';
import { ESPN_ACTIVE_LEAGUE_ID } from '../content/espn-league-profile';
import {
  createBackgroundController,
  type BackgroundControllerDependencies,
} from './background-controller';
import type { DraftStorage } from './draft-storage';
import type { SyncSnapshotClient } from './sync-snapshot-client';

function createStorageMock(mocks: {
  savePicks: DraftStorage['savePicks'];
  saveStatus: DraftStorage['saveStatus'];
  setInstallationDefaults: DraftStorage['setInstallationDefaults'];
}): DraftStorage {
  return {
    load: vi.fn(async () => ({
      picks: [],
      status: { isInDraftRoom: false },
    })),
    savePicks: mocks.savePicks,
    saveStatus: mocks.saveStatus,
    getSyncServerUrl: vi.fn(async () => 'http://localhost:3001'),
    setInstallationDefaults: mocks.setInstallationDefaults,
  };
}

function createSnapshot(
  provider: DraftProvider,
  draftId: string
): DraftSyncSnapshot {
  return {
    provider,
    draftId,
    draft: null,
    picks: [],
    status: 'synced',
    lastPolledAt: 1000,
    lastSuccessfulSyncAt: 1000,
    lastError: null,
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function createDeferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value) => {
      resolvePromise?.(value);
    },
  };
}

describe('background controller with mocked Chrome APIs', () => {
  let storage: DraftStorage;
  let syncClient: SyncSnapshotClient;
  let savePicks: Mock<DraftStorage['savePicks']>;
  let saveStatus: Mock<DraftStorage['saveStatus']>;
  let setInstallationDefaults: Mock<DraftStorage['setInstallationDefaults']>;
  let fetchSnapshot: Mock<SyncSnapshotClient['fetch']>;
  let publishEspnSnapshot: Mock<SyncSnapshotClient['publishEspnSnapshot']>;
  let openSidePanel: Mock<BackgroundControllerDependencies['openSidePanel']>;
  let notifyRuntime: Mock<BackgroundControllerDependencies['notifyRuntime']>;
  let controller: ReturnType<typeof createBackgroundController>;

  beforeEach(async () => {
    savePicks = vi.fn(async () => undefined);
    saveStatus = vi.fn(async () => undefined);
    setInstallationDefaults = vi.fn(async () => undefined);
    storage = createStorageMock({
      savePicks,
      saveStatus,
      setInstallationDefaults,
    });
    fetchSnapshot = vi.fn(async (status: DraftRoomStatus) =>
      status.draftId
        ? createSnapshot(status.provider ?? 'sleeper', status.draftId)
        : null
    );
    publishEspnSnapshot = vi.fn(async (snapshot: EspnDraftSnapshot) => ({
      ...createSnapshot('espn', snapshot.draft.draftId),
      draft: snapshot.draft,
      picks: snapshot.picks,
    }));
    syncClient = {
      fetch: fetchSnapshot,
      publishEspnSnapshot,
    };
    openSidePanel = vi.fn(async () => undefined);
    notifyRuntime = vi.fn(async (_message: ExtensionMessage) => undefined);
    controller = createBackgroundController({
      storage,
      syncClient,
      queryActiveTab: vi.fn(async () => 17),
      openSidePanel,
      notifyRuntime,
      logger: {
        log: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });
    await controller.initialize();
  });

  function dispatch(message: ExtensionMessage): MessageResponse {
    let response: MessageResponse | undefined;
    controller.handleMessage(message, (nextResponse) => {
      response = nextResponse;
    });
    if (!response) {
      throw new Error('The controller did not respond');
    }
    return response;
  }

  it('persists and broadcasts a pick while suppressing Chrome duplicate events', () => {
    const pick: DetectedPick = {
      playerName: 'JaMarr Chase',
      teamName: 'Team 1',
      position: 'WR',
      pickNumber: '1.2',
      timestamp: 1000,
    };

    expect(dispatch({ type: 'PICK_DETECTED', data: pick })).toEqual({
      success: true,
    });
    dispatch({
      type: 'PICK_DETECTED',
      data: { ...pick, timestamp: 10_000 },
    });

    expect(savePicks).toHaveBeenCalledTimes(1);
    expect(notifyRuntime).toHaveBeenCalledTimes(1);
  });

  it('opens the tab side panel and fetches the provider snapshot on entry', async () => {
    dispatch({
      type: 'DRAFT_ROOM_STATUS',
      data: {
        isInDraftRoom: true,
        provider: 'yahoo',
        draftId: '7428778',
      },
    });
    await flushPromises();

    expect(saveStatus).toHaveBeenCalledWith({
      isInDraftRoom: true,
      provider: 'yahoo',
      draftId: '7428778',
    });
    expect(fetchSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'yahoo', draftId: '7428778' })
    );
    expect(openSidePanel).toHaveBeenCalledWith(17);
    expect(notifyRuntime.mock.calls.at(-1)?.[0]).toMatchObject({
      type: 'SYNC_STATE',
      data: {
        snapshot: { provider: 'yahoo', draftId: '7428778' },
      },
    });
  });

  it('initializes Chrome storage defaults on install', async () => {
    await controller.handleInstalled('install');
    expect(setInstallationDefaults).toHaveBeenCalledOnce();
  });

  it('publishes ESPN page snapshots and preserves the detected draft slot', async () => {
    const snapshot: EspnDraftSnapshot = {
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
      observedAt: 1234,
      myDraftSlot: 8,
    };

    expect(dispatch({ type: 'ESPN_DRAFT_SNAPSHOT', data: snapshot })).toEqual({
      success: true,
    });
    await flushPromises();

    expect(publishEspnSnapshot).toHaveBeenCalledWith(snapshot);
    expect(saveStatus).toHaveBeenCalledWith({
      isInDraftRoom: true,
      provider: 'espn',
      draftId: '4242',
      status: 'drafting',
      myDraftSlot: 8,
    });
    expect(notifyRuntime.mock.calls.at(-1)?.[0]).toMatchObject({
      type: 'SYNC_STATE',
      data: {
        snapshot: { provider: 'espn', draftId: '4242' },
      },
    });
  });

  it('attaches the configured league profile in the module background', async () => {
    const snapshot: EspnDraftSnapshot = {
      draft: {
        provider: 'espn',
        draftId: ESPN_ACTIVE_LEAGUE_ID,
        providerKey: `2026:${ESPN_ACTIVE_LEAGUE_ID}`,
        status: 'pre_draft',
        type: 'snake',
        settings: { teams: 14, rounds: 17, pickTimer: 240 },
        draftOrder: null,
      },
      picks: [],
      observedAt: 6000,
    };

    expect(dispatch({ type: 'ESPN_DRAFT_SNAPSHOT', data: snapshot })).toEqual({
      success: true,
    });
    await flushPromises();

    const publishedSnapshot = publishEspnSnapshot.mock.calls.at(-1)?.[0];
    expect(publishedSnapshot?.draft.leagueId).toBe(ESPN_ACTIVE_LEAGUE_ID);
    expect(publishedSnapshot?.draft.leagueSettings).toMatchObject({
      source: 'espn',
      totalTeams: 14,
      keepersEnabled: false,
    });
  });

  it('does not let an older request overwrite a newer snapshot', async () => {
    const olderFetch = createDeferred<DraftSyncSnapshot | null>();
    const newerPublish = createDeferred<DraftSyncSnapshot>();
    fetchSnapshot.mockImplementationOnce(() => olderFetch.promise);
    publishEspnSnapshot.mockImplementationOnce(() => newerPublish.promise);
    const snapshot: EspnDraftSnapshot = {
      draft: {
        provider: 'espn',
        draftId: '4242',
        providerKey: '2026:4242',
        status: 'drafting',
        type: 'snake',
        settings: { teams: 10, rounds: 16, pickTimer: 30 },
        draftOrder: null,
      },
      picks: [],
      observedAt: 2000,
    };

    dispatch({
      type: 'DRAFT_ROOM_STATUS',
      data: { isInDraftRoom: true, provider: 'espn', draftId: '4242' },
    });
    dispatch({ type: 'ESPN_DRAFT_SNAPSHOT', data: snapshot });
    newerPublish.resolve({
      ...createSnapshot('espn', '4242'),
      draft: snapshot.draft,
      lastSuccessfulSyncAt: 2000,
    });
    await flushPromises();
    olderFetch.resolve({
      ...createSnapshot('espn', '4242'),
      lastSuccessfulSyncAt: 1000,
    });
    await flushPromises();

    expect(notifyRuntime.mock.calls.at(-1)?.[0]).toMatchObject({
      type: 'SYNC_STATE',
      data: {
        snapshot: {
          draft: { providerKey: '2026:4242' },
          lastSuccessfulSyncAt: 2000,
        },
      },
    });
  });
});
