import type { Player } from '@fantasy-draft/shared/league';
import { deriveDraft, type DerivedDraft, type DraftFormat, type DraftSource } from '@fantasy-draft/shared/draft';
import type { DraftState } from './types';

type SourceState = Pick<DraftState, 'draftProgress' | 'sessionMode' | 'draftHistory' | 'preloadedKeepers' | 'config' | 'shortlistedPlayerIds'>;

export function draftSource(state: SourceState): DraftSource {
  return {
    progress: state.draftProgress,
    sessionMode: state.sessionMode,
    rosterRequirements: state.config.rosterRequirements,
    history: state.draftHistory,
    keepers: state.preloadedKeepers,
    myTeamIndex: state.config.myPickPosition - 1,
    shortlistOrder: state.shortlistedPlayerIds,
  };
}

export function draftFormat(state: Pick<SourceState, 'config'>): DraftFormat {
  return { type: state.config.draftType, teams: state.config.totalTeams, rounds: state.config.totalRounds };
}

export function deriveDraftState(state: SourceState, players: readonly Player[] = []): DerivedDraft {
  return deriveDraft(draftSource(state), draftFormat(state), players);
}
