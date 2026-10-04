import { Effect, Fiber } from 'effect';
import {
  isEspnDraftSnapshot,
  MAX_DRAFT_PICKS,
  type DraftSyncSnapshot,
  type EspnDraftSnapshot,
} from '@fantasy-draft/shared';
import type {
  ExtensionMessage,
  MessageResponse,
  DraftRoomStatus,
} from '../shared/types';
import { getEspnLeagueSettingsProfile } from '../content/espn-league-profile';
import type { DraftStorage } from './draft-storage';
import { EMPTY_DRAFT_STATE, isDuplicatePick } from './draft-state';
import type { SyncRequestError, SyncSnapshotClient } from './sync-snapshot-client';

type SendResponse = (response: MessageResponse) => void;

export interface BackgroundControllerDependencies {
  readonly storage: DraftStorage;
  readonly syncClient: SyncSnapshotClient;
  readonly queryActiveTab: () => Promise<number | undefined>;
  readonly openSidePanel: (tabId: number) => Promise<void>;
  readonly notifyRuntime: (message: ExtensionMessage) => Promise<unknown>;
  readonly logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

export interface BackgroundController {
  initialize(): Promise<void>;
  handleMessage(message: ExtensionMessage, sendResponse: SendResponse): boolean;
  handleActionClick(tabId: number | undefined): Promise<void>;
  handleInstalled(reason: string): Promise<void>;
}

function sameDraft(
  left: DraftRoomStatus,
  right: DraftRoomStatus
): boolean {
  return (
    left.draftId === right.draftId &&
    (left.provider ?? 'sleeper') === (right.provider ?? 'sleeper')
  );
}

/** Identifies the newest request for a draft; only its result is applied. */
type SnapshotRequest = object;

/**
 * Keep the page-world bridge dependency-free so Chrome can execute it as a
 * classic MAIN-world content script. League-specific configuration is safe to
 * attach here because the background service worker is an ES module.
 */
function attachEspnLeagueProfile(
  snapshot: EspnDraftSnapshot
): EspnDraftSnapshot {
  const leagueId = snapshot.draft.leagueId ?? snapshot.draft.draftId;
  const leagueSettings = getEspnLeagueSettingsProfile(
    leagueId,
    snapshot.observedAt
  );
  if (!leagueSettings) return snapshot;

  return {
    ...snapshot,
    draft: {
      ...snapshot.draft,
      leagueId,
      leagueSettings,
    },
  };
}

export function createBackgroundController(
  dependencies: BackgroundControllerDependencies
): BackgroundController {
  const logger = dependencies.logger ?? console;
  let detectedPicks = [...EMPTY_DRAFT_STATE.picks];
  let draftStatus: DraftRoomStatus = EMPTY_DRAFT_STATE.status;
  let syncSnapshot: DraftSyncSnapshot | null = null;
  // The newest request per draft, read or upload, decides the shown snapshot.
  const latestRequests = new Map<string, SnapshotRequest>();
  // Any newer request cancels a stale read's network call. Uploads are never
  // cancelled, because each one carries draft state the server must ingest.
  const readFibers = new Map<string, Fiber.Fiber<void>>();

  const reportFailure = (operation: string, error: unknown) => {
    logger.warn(`[Fantasy Draft BG] ${operation}:`, error);
  };

  const notifySidePanel = () => {
    void dependencies
      .notifyRuntime({
        type: 'SYNC_STATE',
        data: {
          picks: detectedPicks,
          status: draftStatus,
          snapshot: syncSnapshot,
        },
      })
      .catch(() => {
        // The side panel is optional and may not be open.
      });
  };

  const openForCurrentTab = async () => {
    try {
      const tabId = await dependencies.queryActiveTab();
      if (tabId !== undefined) {
        await dependencies.openSidePanel(tabId);
      }
    } catch (error) {
      reportFailure('Failed to open side panel', error);
    }
  };

  const runSnapshotRequest = (
    requestedStatus: DraftRoomStatus,
    request: Effect.Effect<DraftSyncSnapshot | null, SyncRequestError>,
    options: { readonly failureLabel: string; readonly isRead: boolean }
  ): void => {
    const key = `${requestedStatus.provider ?? 'sleeper'}:${requestedStatus.draftId ?? ''}`;
    const staleRead = readFibers.get(key);
    if (staleRead) Effect.runFork(Fiber.interrupt(staleRead));
    readFibers.delete(key);
    const current: SnapshotRequest = {};
    latestRequests.set(key, current);
    const isCurrent = () => latestRequests.get(key) === current && sameDraft(requestedStatus, draftStatus);
    const fiber = Effect.runFork(request.pipe(
      Effect.match({
        onSuccess: (snapshot) => {
          if (isCurrent()) syncSnapshot = snapshot;
        },
        onFailure: (error) => {
          if (isCurrent()) syncSnapshot = null;
          reportFailure(options.failureLabel, error);
        },
      }),
      Effect.andThen(Effect.sync(() => {
        if (isCurrent()) notifySidePanel();
      })),
      Effect.ensuring(Effect.sync(() => {
        if (latestRequests.get(key) === current) latestRequests.delete(key);
      })),
    ));
    if (options.isRead) {
      readFibers.set(key, fiber);
      fiber.addObserver(() => {
        if (readFibers.get(key) === fiber) readFibers.delete(key);
      });
    }
  };

  const refreshSnapshot = (requestedStatus: DraftRoomStatus) => {
    if (!requestedStatus.draftId) {
      syncSnapshot = null;
      notifySidePanel();
      return;
    }
    runSnapshotRequest(requestedStatus, dependencies.syncClient.fetch(requestedStatus),
      { failureLabel: 'Failed to refresh sync snapshot', isRead: true });
  };

  const publishEspnSnapshot = (
    snapshot: EspnDraftSnapshot,
    requestedStatus: DraftRoomStatus
  ) => {
    runSnapshotRequest(requestedStatus, dependencies.syncClient.publishEspnSnapshot(snapshot),
      { failureLabel: 'Failed to publish ESPN draft snapshot', isRead: false });
  };

  const initialize = async () => {
    const state = await dependencies.storage.load();
    detectedPicks = [...state.picks];
    draftStatus = state.status;
  };

  const handleMessage = (
    message: ExtensionMessage,
    sendResponse: SendResponse
  ): boolean => {
    switch (message.type) {
      case 'PICK_DETECTED': {
        if (!isDuplicatePick(detectedPicks, message.data)) {
          detectedPicks = [...detectedPicks, message.data].slice(-MAX_DRAFT_PICKS);
          void dependencies.storage
            .savePicks(detectedPicks)
            .catch((error: unknown) => {
              reportFailure('Failed to save picks', error);
            });
          notifySidePanel();
        }
        sendResponse({ success: true });
        break;
      }

      case 'ESPN_DRAFT_SNAPSHOT': {
        if (!isEspnDraftSnapshot(message.data)) {
          sendResponse({ success: false, error: 'Invalid ESPN draft snapshot' });
          break;
        }

        const snapshot = attachEspnLeagueProfile(message.data);

        const requestedStatus: DraftRoomStatus = {
          isInDraftRoom: true,
          provider: 'espn',
          draftId: snapshot.draft.draftId,
          status: snapshot.draft.status,
          ...(snapshot.myDraftSlot === undefined
            ? {}
            : { myDraftSlot: snapshot.myDraftSlot }),
        };
        const changedDraft = !sameDraft(draftStatus, requestedStatus);
        draftStatus = requestedStatus;
        if (changedDraft) syncSnapshot = null;
        void dependencies.storage
          .saveStatus(draftStatus)
          .catch((error: unknown) => {
            reportFailure('Failed to save ESPN draft status', error);
          });
        publishEspnSnapshot(snapshot, requestedStatus);
        void openForCurrentTab();
        sendResponse({ success: true });
        break;
      }

      case 'DRAFT_ROOM_STATUS': {
        const changedDraft = !sameDraft(draftStatus, message.data);
        const preservesEspnDetails =
          !changedDraft &&
          message.data.provider === 'espn' &&
          draftStatus.provider === 'espn';
        draftStatus = preservesEspnDetails
          ? {
            ...message.data,
            ...(message.data.myDraftSlot === undefined && draftStatus.myDraftSlot !== undefined
              ? { myDraftSlot: draftStatus.myDraftSlot }
              : {}),
            ...(message.data.status === undefined && draftStatus.status !== undefined
              ? { status: draftStatus.status }
              : {}),
          }
          : message.data;
        if (changedDraft) {
          syncSnapshot = null;
        }
        void dependencies.storage
          .saveStatus(draftStatus)
          .catch((error: unknown) => {
            reportFailure('Failed to save draft status', error);
          });
        refreshSnapshot(draftStatus);
        if (draftStatus.isInDraftRoom) {
          void openForCurrentTab();
        }
        sendResponse({ success: true });
        break;
      }

      case 'GET_DRAFT_STATUS':
        sendResponse({
          success: true,
          data: {
            picks: detectedPicks,
            status: draftStatus,
            snapshot: syncSnapshot,
          },
        });
        break;

      case 'OPEN_SIDE_PANEL':
        void openForCurrentTab();
        sendResponse({ success: true });
        break;

      default:
        sendResponse({ success: false, error: 'Unknown message type' });
    }

    return true;
  };

  const handleActionClick = async (tabId: number | undefined) => {
    if (tabId === undefined) {
      return;
    }
    try {
      await dependencies.openSidePanel(tabId);
    } catch (error) {
      logger.error('[Fantasy Draft BG] Failed to open side panel:', error);
    }
  };

  const handleInstalled = async (reason: string) => {
    logger.log('[Fantasy Draft BG] Extension installed/updated:', reason);
    await dependencies.storage.setInstallationDefaults();
  };

  return {
    initialize,
    handleMessage,
    handleActionClick,
    handleInstalled,
  };
}
