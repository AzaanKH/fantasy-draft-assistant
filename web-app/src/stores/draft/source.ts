import type { Player } from '@fantasy-draft/shared/league';
import { deriveDraft, getEffectiveKeeperAssignments, type DerivedDraft, type DraftFormat, type DraftSource } from '@fantasy-draft/shared/draft';
import type { DraftState, PreloadedKeeper } from './types';

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

/** Keeper reservations that completed history has not superseded. A superseded slot is an ordinary pick. */
export function effectiveKeepers(state: Pick<SourceState, 'draftHistory' | 'preloadedKeepers' | 'config'>): PreloadedKeeper[] {
  return getEffectiveKeeperAssignments(state.preloadedKeepers, state.draftHistory, state.config.totalTeams, state.config.draftType);
}

export function deriveDraftState(state: SourceState, players: readonly Player[] = []): DerivedDraft {
  return deriveDraft(draftSource(state), draftFormat(state), players);
}
