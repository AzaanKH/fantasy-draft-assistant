import type { UndecodedEspnSnapshotRelay } from './chrome-messenger';

const ESPN_BRIDGE_SOURCE = 'fantasy-draft-assistant:espn';
const ESPN_BRIDGE_VERSION = 1;

export function startEspnContentBridge(
  forwardUndecodedSnapshot: UndecodedEspnSnapshotRelay,
  targetWindow: Window = window
): () => void {
  const handleMessage = (event: MessageEvent<unknown>) => {
    if (event.source !== targetWindow || event.origin !== targetWindow.location.origin) return;
    const envelope = event.data;
    if (typeof envelope !== 'object' || envelope === null ||
        !('source' in envelope) || envelope.source !== ESPN_BRIDGE_SOURCE ||
        !('version' in envelope) || envelope.version !== ESPN_BRIDGE_VERSION ||
        !('type' in envelope) || envelope.type !== 'ESPN_DRAFT_SNAPSHOT') return;
    forwardUndecodedSnapshot('snapshot' in envelope ? envelope.snapshot : undefined);
  };

  targetWindow.addEventListener('message', handleMessage);
  targetWindow.postMessage({
    source: ESPN_BRIDGE_SOURCE,
    version: ESPN_BRIDGE_VERSION,
    type: 'REQUEST_ESPN_DRAFT_SNAPSHOT',
  }, targetWindow.location.origin);

  return () => { targetWindow.removeEventListener('message', handleMessage); };
}
