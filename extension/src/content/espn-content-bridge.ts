import type { EspnDraftSnapshot } from '@fantasy-draft/shared';
import type { ExtensionMessageSender } from './chrome-messenger';

const ESPN_BRIDGE_SOURCE = 'fantasy-draft-assistant:espn';
const ESPN_BRIDGE_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isEspnSnapshotEnvelope(value: unknown): value is {
  readonly snapshot: EspnDraftSnapshot;
} {
  if (!isRecord(value) || !isRecord(value['snapshot'])) return false;
  const snapshot = value['snapshot'];
  const draft = snapshot['draft'];
  return (
    isRecord(draft) &&
    draft['provider'] === 'espn' &&
    typeof draft['draftId'] === 'string' &&
    Array.isArray(snapshot['picks']) &&
    typeof snapshot['observedAt'] === 'number'
  );
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
