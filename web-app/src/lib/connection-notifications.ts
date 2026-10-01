import type { DraftSyncConnectionState } from '@/hooks/useDraftSync';

export interface ConnectionNoticeState {
  readonly key: string | null;
  readonly provider: string;
  readonly state: DraftSyncConnectionState;
}
export interface ConnectionNotice {
  readonly kind: 'success' | 'warning' | 'error' | 'info';
  readonly message: string;
  readonly description?: string;
}
function phase(state: DraftSyncConnectionState): string {
  return state === 'reconnecting' || state === 'stale' ? 'delayed' : state;
}

/** Ignore polling ticks and the stale/reconnecting cycle; announce meaningful transitions. */
export function getConnectionNotice(previous: ConnectionNoticeState | null, next: ConnectionNoticeState): ConnectionNotice | null {
  if (!next.key) return previous?.key ? { kind: 'info', message: `${previous.provider} disconnected` } : null;
  const sameDraft = previous?.key === next.key;
  if (sameDraft && phase(previous.state) === phase(next.state)) return null;
  if (next.state === 'connected') {
    const recovered = sameDraft && ['delayed', 'error'].includes(phase(previous.state));
    return { kind: 'success', message: `${next.provider} ${recovered ? 'connection restored' : 'draft connected'}` };
  }
  if (next.state === 'complete') return { kind: 'success', message: 'Draft complete' };
  if (next.state === 'error') return {
    kind: 'error', message: `${next.provider} sync failed`,
    description: 'Open the connection control for details and retry options.',
  };
  if (phase(next.state) === 'delayed') return {
    kind: 'warning', message: `${next.provider} updates are delayed`,
    description: 'The board shows the last confirmed picks. Connection details remain in the navbar.',
  };
  return null;
}
