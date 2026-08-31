import type { EspnDraftSnapshot } from '@fantasy-draft/shared';
import type { ExtensionMessageSender } from './chrome-messenger';

const ESPN_BRIDGE_SOURCE = 'fantasy-draft-assistant:espn';
const ESPN_BRIDGE_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFiniteNumberRecord(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every(isFiniteNumber);
}

function isEspnDraftMetadata(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value['settings'])) return false;
  const settings = value['settings'];
  return (
    value['provider'] === 'espn' &&
    typeof value['draftId'] === 'string' &&
    typeof value['providerKey'] === 'string' &&
    (value['leagueId'] === undefined || typeof value['leagueId'] === 'string') &&
    value['leagueSettings'] === undefined &&
    (
      value['status'] === 'pre_draft' ||
      value['status'] === 'drafting' ||
      value['status'] === 'paused' ||
      value['status'] === 'complete'
    ) &&
    (
      value['type'] === 'snake' ||
      value['type'] === 'linear' ||
      value['type'] === 'auction'
    ) &&
    isFiniteNumber(settings['teams']) &&
    isFiniteNumber(settings['rounds']) &&
    isFiniteNumber(settings['pickTimer']) &&
    (
      value['draftOrder'] === null ||
      isFiniteNumberRecord(value['draftOrder'])
    )
  );
}

function isEspnDraftPick(value: unknown, draftId: string): boolean {
  return (
    isRecord(value) &&
    value['draftId'] === draftId &&
    isFiniteNumber(value['pickNumber']) &&
    isFiniteNumber(value['round']) &&
    (value['rosterId'] === null || isFiniteNumber(value['rosterId'])) &&
    isFiniteNumber(value['draftSlot']) &&
    isFiniteNumber(value['teamIndex']) &&
    typeof value['playerId'] === 'string' &&
    typeof value['playerName'] === 'string' &&
    (
      value['position'] === null ||
      value['position'] === 'QB' ||
      value['position'] === 'RB' ||
      value['position'] === 'WR' ||
      value['position'] === 'TE' ||
      value['position'] === 'K' ||
      value['position'] === 'DEF'
    ) &&
    (value['nflTeam'] === null || typeof value['nflTeam'] === 'string') &&
    typeof value['isKeeper'] === 'boolean' &&
    value['source'] === 'espn-extension' &&
    (value['confidence'] === 'confirmed' || value['confidence'] === 'probable') &&
    isFiniteNumber(value['observedAt'])
  );
}

function isEspnDraftSnapshot(value: unknown): value is EspnDraftSnapshot {
  if (
    !isRecord(value) ||
    !isEspnDraftMetadata(value['draft']) ||
    !isRecord(value['draft']) ||
    !Array.isArray(value['picks']) ||
    !isFiniteNumber(value['observedAt'])
  ) {
    return false;
  }

  const draftId = value['draft']['draftId'];
  if (typeof draftId !== 'string') return false;
  if (
    value['myDraftSlot'] !== undefined &&
    (!isFiniteNumber(value['myDraftSlot']) || value['myDraftSlot'] < 1)
  ) {
    return false;
  }
  return value['picks'].every((pick) => isEspnDraftPick(pick, draftId));
}

interface EspnSnapshotEnvelope {
  readonly snapshot: EspnDraftSnapshot;
}

function isEspnSnapshotEnvelope(
  value: unknown
): value is EspnSnapshotEnvelope {
  return isRecord(value) && isEspnDraftSnapshot(value['snapshot']);
}

export function startEspnContentBridge(
  sendMessage: ExtensionMessageSender,
  targetWindow: Window = window
): () => void {
  const handleMessage = (event: MessageEvent<unknown>) => {
    if (
      event.source !== targetWindow ||
      event.origin !== targetWindow.location.origin ||
      !isRecord(event.data) ||
      event.data['source'] !== ESPN_BRIDGE_SOURCE ||
      event.data['version'] !== ESPN_BRIDGE_VERSION ||
      event.data['type'] !== 'ESPN_DRAFT_SNAPSHOT' ||
      !isEspnSnapshotEnvelope(event.data)
    ) {
      return;
    }

    sendMessage({
      type: 'ESPN_DRAFT_SNAPSHOT',
      data: event.data.snapshot,
    });
  };

  targetWindow.addEventListener('message', handleMessage);
  const request = {
    source: ESPN_BRIDGE_SOURCE,
    version: ESPN_BRIDGE_VERSION,
    type: 'REQUEST_ESPN_DRAFT_SNAPSHOT',
  } as const;
  targetWindow.postMessage(request, targetWindow.location.origin);

  return () => {
    targetWindow.removeEventListener('message', handleMessage);
  };
}
