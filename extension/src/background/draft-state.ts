import type { DetectedPick, DraftRoomStatus } from '../shared/types';

export interface PersistedDraftState {
  readonly picks: DetectedPick[];
  readonly status: DraftRoomStatus;
}

export const EMPTY_DRAFT_STATE: PersistedDraftState = {
  picks: [],
  status: { isInDraftRoom: false },
};

export function isDuplicatePick(
  picks: readonly DetectedPick[],
  candidate: DetectedPick
): boolean {
  return picks.some(
    (pick) =>
      pick.playerName === candidate.playerName &&
      Math.abs(pick.timestamp - candidate.timestamp) < 5000
  );
}
