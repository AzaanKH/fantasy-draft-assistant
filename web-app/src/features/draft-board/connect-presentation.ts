/**
 * One presentation state for the live-draft connection summary, derived from the independent
 * connection flags in a fixed precedence. The row renders tone, icon, headline, badge and action
 * from this alone, so contradictory pairs (a spinner beside "Connect", "Ready" beside "Choose slot")
 * cannot occur.
 */
export type ConnectKind = 'blocked' | 'error' | 'connecting' | 'disconnected' | 'choose-slot' | 'import-warning' | 'connected';

export interface ConnectPresentation {
  readonly kind: ConnectKind;
  readonly tone: 'bad' | 'warn' | 'ok' | 'neutral';
  /** Short status badge beside the headline, only once the draft is connected and settled. */
  readonly badge: 'Attention' | 'Complete' | 'Live' | 'Paused' | 'Ready' | null;
}

export interface ConnectFlags {
  readonly isStrip: boolean;
  readonly liveDraftBlocked: boolean;
  readonly connectedDraftId: string | null;
  readonly isError: boolean;
  readonly isConnecting: boolean;
  readonly isDraftPositionConfirmed: boolean;
  readonly hasImportWarning: boolean;
  readonly isComplete: boolean;
  readonly isDrafting: boolean;
  readonly isPaused: boolean;
}

/** Precedence: readiness blocker (strip only) › sync error › connecting › not connected › slot › import warning › connected. */
export function getConnectPresentation(flags: ConnectFlags): ConnectPresentation {
  if (flags.isStrip && flags.liveDraftBlocked) return { kind: 'blocked', tone: 'bad', badge: null };
  if (flags.isError) return { kind: 'error', tone: 'bad', badge: null };
  if (flags.isConnecting) return { kind: 'connecting', tone: 'neutral', badge: null };
  if (!flags.connectedDraftId) return { kind: 'disconnected', tone: 'neutral', badge: null };
  if (!flags.isDraftPositionConfirmed) return { kind: 'choose-slot', tone: 'neutral', badge: null };
  if (flags.hasImportWarning) return { kind: 'import-warning', tone: 'warn', badge: 'Attention' };
  const badge = flags.isComplete ? 'Complete' : flags.isDrafting ? 'Live' : flags.isPaused ? 'Paused' : 'Ready';
  return { kind: 'connected', tone: 'ok', badge };
}
