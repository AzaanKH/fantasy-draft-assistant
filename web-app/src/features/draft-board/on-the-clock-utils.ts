import type { DraftType } from '@fantasy-draft/shared';
import { getTeamIndexForDraftPick } from '@/lib/mock-draft-engine';

export function getPicksUntilMyTurn(
  currentPick: number,
  myPickPosition: number,
  totalTeams: number,
  totalRounds: number,
  draftType: DraftType = 'snake'
): number | null {
  const totalPicks = totalTeams * totalRounds;

  for (let pick = currentPick; pick <= totalPicks; pick += 1) {
    if (getTeamIndexForDraftPick(pick, totalTeams, draftType) === myPickPosition - 1) {
      return pick - currentPick;
    }
  }

  return null;
}
