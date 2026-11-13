import { describe, expect, it } from 'vitest';
import { getConnectPresentation, type ConnectFlags } from './connect-presentation';

const connected: ConnectFlags = {
  isStrip: false, liveDraftBlocked: false, connectedDraftId: 'draft-1', isError: false, isConnecting: false,
  isDraftPositionConfirmed: true, hasImportWarning: false, isComplete: false, isDrafting: true, isPaused: false,
};

describe('getConnectPresentation', () => {
  it('reports a settled connection with its draft status', () => {
    expect(getConnectPresentation(connected)).toEqual({ kind: 'connected', tone: 'ok', badge: 'Live' });
    expect(getConnectPresentation({ ...connected, isDrafting: false, isComplete: true }).badge).toBe('Complete');
  });

  it('never pairs a connecting spinner with the disconnected prompt', () => {
    expect(getConnectPresentation({ ...connected, connectedDraftId: null, isConnecting: true }).kind).toBe('connecting');
  });

  it('shows no Ready badge while the slot still needs choosing', () => {
    expect(getConnectPresentation({ ...connected, isDraftPositionConfirmed: false })).toEqual({ kind: 'choose-slot', tone: 'neutral', badge: null });
  });

  it('lets an error outrank connecting and the import warning, and a strip blocker outrank everything', () => {
    expect(getConnectPresentation({ ...connected, isError: true, isConnecting: true, hasImportWarning: true }).kind).toBe('error');
    expect(getConnectPresentation({ ...connected, isStrip: true, liveDraftBlocked: true, isError: true }).kind).toBe('blocked');
    // The card (not the strip) never shows the readiness blocker.
    expect(getConnectPresentation({ ...connected, liveDraftBlocked: true }).kind).toBe('connected');
  });
});
