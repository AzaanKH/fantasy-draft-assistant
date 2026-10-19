import { createSlotSequence } from '@fantasy-draft/shared';
import { type DraftType } from '@fantasy-draft/shared/sync';

export function getPicksUntilMyTurn(
  currentPick: number,
  myPickPosition: number,
  totalTeams: number,
  totalRounds: number,
  draftType: DraftType
): number | null {
  return createSlotSequence({ type: draftType, teams: totalTeams, rounds: totalRounds })
    .picksUntilTurn(myPickPosition - 1, currentPick);
}
