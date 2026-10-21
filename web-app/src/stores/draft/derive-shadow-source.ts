import type { DraftFormat, DraftSource } from '@fantasy-draft/shared/draft';
import type { DraftState } from './types';

type SourceState = Pick<DraftState, 'draftProgress' | 'sessionMode' | 'draftHistory' | 'preloadedKeepers' | 'config' | 'shortlistedPlayerIds'>;

export function shadowSource(state: SourceState): DraftSource {
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

export function shadowFormat(state: Pick<SourceState, 'config'>): DraftFormat {
  return { type: state.config.draftType, teams: state.config.totalTeams, rounds: state.config.totalRounds };
}
