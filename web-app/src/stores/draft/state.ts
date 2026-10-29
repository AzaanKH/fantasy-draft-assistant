import { createDraft, finishDraft } from 'immer';
import { deriveDraftState } from './source';
import { DEFAULT_ROSTER_REQUIREMENTS } from '@fantasy-draft/shared/league';
import type { DraftType } from '@fantasy-draft/shared/sync';
import { getEffectiveKeeperAssignments, getKeeperPickNumber } from '@fantasy-draft/shared/draft';
import type { PreloadedKeeper, DraftState, DraftTransition, RecordedDraftPick, FilterState, DraftConfig, MockDraftSettings } from './types';

export function getKeeperPickNumbers(
  keepers: readonly PreloadedKeeper[],
  totalTeams: number,
  draftType: DraftType
): Set<number> {
  return new Set(keepers.map((keeper) =>
    getKeeperPickNumber(keeper, totalTeams, draftType)
  ));
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

export function acceptProvisionalProgress(state: Pick<
  DraftState, 'config' | 'draftProgress' | 'draftHistory' | 'preloadedKeepers' | 'shortlistedPlayerIds' | 'sessionMode' | 'mockSurvivalProbabilities'
>): void {
  state.draftHistory.sort((left, right) => left.pickNumber - right.pickNumber);
  state.shortlistedPlayerIds = [...deriveDraftState(state).shortlistedPlayerIds];
  const effectiveKeepers = getEffectiveKeeperAssignments(
    state.preloadedKeepers, state.draftHistory, state.config.totalTeams, state.config.draftType
  );
  state.draftProgress = {
    anchor: { kind: 'first-open', keeperSlots: [...getKeeperPickNumbers(effectiveKeepers, state.config.totalTeams, state.config.draftType)],
      totalPicks: state.config.totalTeams * state.config.totalRounds },
    historyLength: state.draftHistory.length,
  };
  state.mockSurvivalProbabilities = {};
}

export function runDraftTransition<State extends DraftState, Result>(
  state: State,
  transition: DraftTransition<Result>
): { readonly next: State; readonly result: Result } {
  const draft = createDraft(state);
  const result = transition(draft);
  return { next: finishDraft(draft) as State, result };
}

export const defaultFilter: FilterState = {
  position: 'ALL',
  searchQuery: '',
};

/** Default draft configuration for the Primary League. */
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
  cpuPickPace: 'watch',
};
