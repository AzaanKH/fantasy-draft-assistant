import {
  isEspnDraftSnapshot,
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
import type { SyncSnapshotClient } from './sync-snapshot-client';

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

interface SnapshotRequestToken {
  readonly key: string;
  readonly value: number;
}

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
  const latestSnapshotRequestByDraft = new Map<string, number>();

  const beginSnapshotRequest = (
    status: DraftRoomStatus
  ): SnapshotRequestToken => {
    const key = `${status.provider ?? 'sleeper'}:${status.draftId ?? ''}`;
    const value = (latestSnapshotRequestByDraft.get(key) ?? 0) + 1;
    latestSnapshotRequestByDraft.set(key, value);
    return { key, value };
  };

  const isCurrentSnapshotRequest = (
    token: SnapshotRequestToken,
    requestedStatus: DraftRoomStatus
  ): boolean =>
    latestSnapshotRequestByDraft.get(token.key) === token.value &&
    sameDraft(requestedStatus, draftStatus);

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

  const refreshSnapshot = async (requestedStatus: DraftRoomStatus) => {
    if (!requestedStatus.draftId) {
      syncSnapshot = null;
      notifySidePanel();
      return;
    }
    const requestToken = beginSnapshotRequest(requestedStatus);

    try {
      const snapshot = await dependencies.syncClient.fetch(requestedStatus);
      if (isCurrentSnapshotRequest(requestToken, requestedStatus)) {
        syncSnapshot = snapshot;
      }
    } catch (error) {
      if (isCurrentSnapshotRequest(requestToken, requestedStatus)) {
        syncSnapshot = null;
      }
      reportFailure('Failed to refresh sync snapshot', error);
    }

    if (isCurrentSnapshotRequest(requestToken, requestedStatus)) {
      notifySidePanel();
    }
  };

  const publishEspnSnapshot = async (
    snapshot: EspnDraftSnapshot,
    requestedStatus: DraftRoomStatus
  ) => {
    const requestToken = beginSnapshotRequest(requestedStatus);
    try {
      const published = await dependencies.syncClient.publishEspnSnapshot(snapshot);
      if (isCurrentSnapshotRequest(requestToken, requestedStatus)) {
        syncSnapshot = published;
      }
    } catch (error) {
      if (isCurrentSnapshotRequest(requestToken, requestedStatus)) {
        syncSnapshot = null;
      }
      reportFailure('Failed to publish ESPN draft snapshot', error);
    }

    if (isCurrentSnapshotRequest(requestToken, requestedStatus)) {
      notifySidePanel();
    }
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
          detectedPicks = [...detectedPicks, message.data];
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
        void publishEspnSnapshot(snapshot, requestedStatus);
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
        void refreshSnapshot(draftStatus);
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
