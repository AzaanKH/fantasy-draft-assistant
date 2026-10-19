import type { DraftFormat, DraftSource } from '@fantasy-draft/shared/draft';
import type { DraftState } from './types';

type SourceState = Pick<DraftState, 'draftHistory' | 'preloadedKeepers' | 'config' | 'shortlistedPlayerIds' | 'unresolvedProviderPicks'>;

export function shadowSource(state: SourceState): DraftSource {
  return {
    history: state.draftHistory,
    keepers: state.preloadedKeepers,
    myTeamIndex: state.config.myPickPosition - 1,
    shortlistOrder: state.shortlistedPlayerIds,
    unresolvedPicks: state.unresolvedProviderPicks,
  };
}

export function shadowFormat(state: Pick<SourceState, 'config'>): DraftFormat {
  return { type: state.config.draftType, teams: state.config.totalTeams, rounds: state.config.totalRounds };
}
