import { describe, expect, it } from 'vitest';
import {
  isDetectedPick,
  isDraftRoomStatus,
  isExtensionMessage,
  isExtensionState,
} from './types';

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

describe('extension runtime guards', () => {
  it('validates detected picks and draft room fields', () => {
    expect(isDetectedPick({
      playerName: 'Breece Hall',
      teamName: 'Team Alpha',
      timestamp: 1000,
    })).toBe(true);
    expect(isDetectedPick({
      playerName: 'Breece Hall',
      teamName: 'Team Alpha',
      timestamp: '1000',
    })).toBe(false);
    expect(isDraftRoomStatus({
      isInDraftRoom: true,
      provider: 'espn',
      draftId: '42',
      myDraftSlot: 3,
    })).toBe(true);
    expect(isDraftRoomStatus({
      isInDraftRoom: true,
      provider: 'invalid',
      myDraftSlot: 0,
    })).toBe(false);
  });

  it('rejects invalid snapshots before accepting extension state', () => {
    const state = {
      picks: [],
      status: { isInDraftRoom: true, provider: 'sleeper', draftId: 'draft-123' },
      snapshot,
    };
    expect(isExtensionState(state)).toBe(true);
    expect(isExtensionMessage({ type: 'SYNC_STATE', data: state })).toBe(true);
    expect(isExtensionState({
      ...state,
      snapshot: { ...snapshot, provider: 'invalid' },
    })).toBe(false);
    expect(isExtensionMessage({ type: 'PICK_DETECTED', data: null })).toBe(false);
  });
});
