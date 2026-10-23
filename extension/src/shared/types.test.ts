import { describe, expect, it } from 'vitest';
import {
  decodeDetectedPick,
  decodeDraftRoomStatus,
  decodeExtensionMessage,
  decodeExtensionState,
} from './boundary-decoders';

const snapshot = {
  provider: 'sleeper',
  draftId: 'draft-123',
  draft: null,
  picks: [],
  status: 'synced',
  lastPolledAt: 1000,
  lastSuccessfulSyncAt: 1000,
  lastError: null,
} as const;

describe('extension runtime decoders', () => {
  it('validates detected picks and draft room fields', () => {
    expect(() => decodeDetectedPick({
      playerName: 'Breece Hall',
      teamName: 'Team Alpha',
      timestamp: 1000,
    })).not.toThrow();
    expect(() => decodeDetectedPick({
      playerName: 'Breece Hall',
      teamName: 'Team Alpha',
      timestamp: '1000',
    })).toThrow();
    expect(() => decodeDraftRoomStatus({
      isInDraftRoom: true,
      provider: 'espn',
      draftId: '42',
      myDraftSlot: 3,
    })).not.toThrow();
    expect(() => decodeDraftRoomStatus({
      isInDraftRoom: true,
      provider: 'invalid',
      myDraftSlot: 0,
    })).toThrow();
  });

  it('rejects invalid snapshots before accepting extension state', () => {
    const state = {
      picks: [],
      status: { isInDraftRoom: true, provider: 'sleeper', draftId: 'draft-123' },
      snapshot,
    };
    expect(decodeExtensionState(state)).toEqual(state);
    expect(decodeExtensionMessage({ type: 'SYNC_STATE', data: state })).toEqual({ type: 'SYNC_STATE', data: state });
    expect(() => decodeExtensionState({
      ...state,
      snapshot: { ...snapshot, provider: 'invalid' },
    })).toThrow();
    expect(() => decodeExtensionMessage({ type: 'PICK_DETECTED', data: null })).toThrow();
  });
});


describe('extension boundary acceptance', () => {
  it('preserves extra fields and rejects a whole malformed state', () => {
    const pick = { playerName: 'Player', teamName: 'Manager', timestamp: 1000, extra: { provider: 42 } };
    const state = { picks: [pick], status: { isInDraftRoom: false }, extra: 'kept' };
    expect(decodeExtensionState(state)).toEqual(state);
    expect(() => decodeExtensionState({ ...state, picks: [pick, { ...pick, timestamp: 'wrong' }] })).toThrow();
    for (const type of ['GET_DRAFT_STATUS', 'OPEN_SIDE_PANEL']) {
      expect(decodeExtensionMessage({ type, extra: 'kept' })).toEqual({ type, extra: 'kept' });
    }
  });
});
