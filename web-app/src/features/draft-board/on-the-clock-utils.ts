function getDraftSlot(pick: number, totalTeams: number): number {
  const round = Math.ceil(pick / totalTeams);
  const pickInRound = ((pick - 1) % totalTeams) + 1;
  return round % 2 === 1 ? pickInRound : totalTeams - pickInRound + 1;
}

export function getPicksUntilMyTurn(
  currentPick: number,
  myPickPosition: number,
  totalTeams: number,
  totalRounds: number
): number | null {
  const totalPicks = totalTeams * totalRounds;

  for (let pick = currentPick; pick <= totalPicks; pick += 1) {
    if (getDraftSlot(pick, totalTeams) === myPickPosition) {
      return pick - currentPick;
    }
  }

  return null;
}
