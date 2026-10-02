import { DEFAULT_ROSTER_REQUIREMENTS, type DraftType, type Position } from '@fantasy-draft/shared';
import { getEffectiveKeeperAssignments, getKeeperPickNumber } from '@/lib/keeper-supply';
import type {
  MutableRoster,
  PreloadedKeeper,
  DraftState,
  RecordedDraftPick,
  FilterState,
  DraftConfig,
  MockDraftSettings,
} from './types';

export function createEmptyMutableRoster(): MutableRoster {
  return {
    QB: [],
    RB: [],
    WR: [],
    TE: [],
    K: [],
    DEF: [],
  };
}

export function addPlayerToRoster(
  roster: MutableRoster,
  position: Position,
  playerId: string
): void {
  if (!roster[position].includes(playerId)) {
    roster[position].push(playerId);
  }
}

export function getKeeperPickNumbers(
  keepers: readonly PreloadedKeeper[],
  totalTeams: number,
  draftType: DraftType
): Set<number> {
  return new Set(keepers.map((keeper) =>
    getKeeperPickNumber(keeper, totalTeams, draftType)
  ));
}

export function advancePastKeeperSlots(
  pickNumber: number,
  keepers: readonly PreloadedKeeper[],
  totalTeams: number,
  totalPicks: number,
  draftType: DraftType
): number {
  let nextPick = pickNumber;
  const keeperPicks = getKeeperPickNumbers(keepers, totalTeams, draftType);
  while (
    nextPick <= totalPicks &&
    keeperPicks.has(nextPick)
  ) {
    nextPick += 1;
  }
  return nextPick;
}

export function createEmptyTeamRosters(totalTeams: number): MutableRoster[] {
  return Array.from(
    { length: Math.max(0, totalTeams) },
    createEmptyMutableRoster
  );
}

export function copyRoster(roster: MutableRoster | undefined): MutableRoster {
  if (!roster) return createEmptyMutableRoster();
  return {
    QB: [...roster.QB],
    RB: [...roster.RB],
    WR: [...roster.WR],
    TE: [...roster.TE],
    K: [...roster.K],
    DEF: [...roster.DEF],
  };
}

export function rebuildCanonicalRosters(state: Pick<
  DraftState,
  'config' | 'draftHistory' | 'preloadedKeepers' | 'myRoster' | 'teamRosters'
>): void {
  const teamRosters = createEmptyTeamRosters(state.config.totalTeams);
  const effectiveKeepers = getEffectiveKeeperAssignments(
    state.preloadedKeepers,
    state.draftHistory,
    state.config.totalTeams,
    state.config.draftType
  );

  for (const keeper of effectiveKeepers) {
    const roster = teamRosters[keeper.teamIndex];
    if (roster) addPlayerToRoster(roster, keeper.position, keeper.playerId);
  }
  for (const pick of state.draftHistory) {
    const roster = teamRosters[pick.teamIndex];
    if (roster) addPlayerToRoster(roster, pick.position, pick.playerId);
  }

  state.teamRosters = teamRosters;
  state.myRoster = copyRoster(teamRosters[state.config.myPickPosition - 1]);
}

export function getNextCanonicalOpenPick(
  history: readonly RecordedDraftPick[],
  keepers: readonly PreloadedKeeper[],
  totalTeams: number,
  totalPicks: number,
  draftType: DraftType
): number {
  const occupied = new Set(history.map((pick) => pick.pickNumber));
  for (const keeperPick of getKeeperPickNumbers(keepers, totalTeams, draftType)) {
    occupied.add(keeperPick);
  }

  for (let pickNumber = 1; pickNumber <= totalPicks; pickNumber += 1) {
    if (!occupied.has(pickNumber)) return pickNumber;
  }
  return totalPicks + 1;
}

export function restoreShortlistedPlayer(
  shortlistedPlayerIds: string[],
  pick: RecordedDraftPick
): void {
  if (
    pick.shortlistIndex === undefined ||
    shortlistedPlayerIds.includes(pick.playerId)
  ) {
    return;
  }

  shortlistedPlayerIds.splice(
    Math.min(pick.shortlistIndex, shortlistedPlayerIds.length),
    0,
    pick.playerId
  );
}

export function rebuildAfterProvisionalChange(state: Pick<
  DraftState,
  | 'config'
  | 'currentPick'
  | 'draftedPlayerIds'
  | 'draftHistory'
  | 'shortlistedPlayerIds'
  | 'preloadedKeepers'
  | 'myRoster'
  | 'teamRosters'
  | 'mockSurvivalProbabilities'
>): void {
  state.draftHistory.sort((left, right) => left.pickNumber - right.pickNumber);
  const effectiveKeepers = getEffectiveKeeperAssignments(
    state.preloadedKeepers,
    state.draftHistory,
    state.config.totalTeams
  );
  state.draftedPlayerIds = new Set([
    ...state.draftHistory.map((pick) => pick.playerId),
    ...effectiveKeepers.map((keeper) => keeper.playerId),
  ]);
  state.shortlistedPlayerIds = state.shortlistedPlayerIds.filter(
    (playerId) => !state.draftedPlayerIds.has(playerId)
  );
  rebuildCanonicalRosters(state);
  state.currentPick = getNextCanonicalOpenPick(
    state.draftHistory,
    effectiveKeepers,
    state.config.totalTeams,
    state.config.totalTeams * state.config.totalRounds,
    state.config.draftType
  );
  state.mockSurvivalProbabilities = {};
}

export function calculateIsMyTurn(
  currentPick: number,
  myPickPosition: number,
  totalTeams: number
): boolean {
  // Snake draft: odd rounds go 1-10, even rounds go 10-1
  const round = Math.ceil(currentPick / totalTeams);
  const pickInRound = ((currentPick - 1) % totalTeams) + 1;

  const isOddRound = round % 2 === 1;
  const positionThisRound = isOddRound
    ? pickInRound
    : totalTeams - pickInRound + 1;

  return positionThisRound === myPickPosition;
}

/**
 * Default filter state
 */
export const defaultFilter: FilterState = {
  position: 'ALL',
  searchQuery: '',
};

/**
 * Default draft configuration for the Primary League (10 teams, 14 rounds)
 */
export const defaultConfig: DraftConfig = {
  totalTeams: 10,
  totalRounds: 14,
  draftType: 'snake',
  myPickPosition: 5,
  rosterRequirements: DEFAULT_ROSTER_REQUIREMENTS,
};

export const defaultMockSettings: MockDraftSettings = {
  randomness: 0.55,
  seed: 20260810,
  survivalIterations: 250,
};

