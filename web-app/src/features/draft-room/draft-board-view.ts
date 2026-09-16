import { getPicksUntilMyTurn } from '@/features/draft-board/on-the-clock-utils';
import { getTeamIndexForPick } from '@/lib/mock-draft-engine';

export interface DraftBoardCurrentView {
  readonly activeRound: number | null;
  readonly activeTeamIndex: number;
  readonly mobileTeamIndices: readonly number[];
  readonly upcomingMyPickNumber: number | null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function getCenteredTeamSlice(
  centerTeamIndex: number,
  totalTeams: number,
  requestedSize: number = 3
): readonly number[] {
  if (totalTeams <= 0 || requestedSize <= 0) return [];

  const size = Math.min(totalTeams, requestedSize);
  const normalizedCenter = clamp(centerTeamIndex, 0, totalTeams - 1);
  const start = clamp(
    normalizedCenter - Math.floor(size / 2),
    0,
    totalTeams - size
  );

  return Array.from({ length: size }, (_, offset) => start + offset);
}

export function getDraftBoardCurrentView({
  currentPick,
  myPickPosition,
  totalTeams,
  totalRounds,
}: {
  readonly currentPick: number;
  readonly myPickPosition: number;
  readonly totalTeams: number;
  readonly totalRounds: number;
}): DraftBoardCurrentView {
  const totalPicks = totalTeams * totalRounds;
  const isComplete = currentPick > totalPicks;
  const activePickNumber = clamp(currentPick, 1, Math.max(1, totalPicks));
  const activeTeamIndex = isComplete
    ? clamp(myPickPosition - 1, 0, Math.max(0, totalTeams - 1))
    : getTeamIndexForPick(activePickNumber, totalTeams);
  const picksUntilMyTurn = isComplete
    ? null
    : getPicksUntilMyTurn(
        currentPick,
        myPickPosition,
        totalTeams,
        totalRounds
      );

  return {
    activeRound: isComplete ? null : Math.ceil(activePickNumber / totalTeams),
    activeTeamIndex,
    mobileTeamIndices: getCenteredTeamSlice(activeTeamIndex, totalTeams),
    upcomingMyPickNumber: picksUntilMyTurn === null
      ? null
      : currentPick + picksUntilMyTurn,
  };
}
