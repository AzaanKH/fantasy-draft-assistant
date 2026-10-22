import type { DraftActions } from '@/stores/draft/types';
import type { DraftCommand } from './draft-reducer';

export function dispatchDraftCommand(actions: DraftActions, command: DraftCommand, queue: () => readonly string[] = () => []): unknown {
  let result: unknown;
  switch (command[0]) {
      case 'setSessionMode': { const [, ...args] = command; actions.setSessionMode(...args); break; }
      case 'setLiveDraftSession': { const [, ...args] = command; actions.setLiveDraftSession(...args); break; }
      case 'enterManualContinuity': { const [, ...args] = command; actions.enterManualContinuity(...args); break; }
      case 'setConfig': { const [, ...args] = command; actions.setConfig(...args); break; }
      case 'applyLeagueSettings': { const [, ...args] = command; actions.applyLeagueSettings(...args); break; }
      case 'setRosterRequirements': { const [, ...args] = command; actions.setRosterRequirements(...args); break; }
      case 'setMockSettings': { const [, ...args] = command; actions.setMockSettings(...args); break; }
      case 'setMockAutoAdvancePaused': { const [, ...args] = command; actions.setMockAutoAdvancePaused(...args); break; }
      case 'setMockSettingsOpen': { const [, ...args] = command; actions.setMockSettingsOpen(...args); break; }
      case 'markPlayerDrafted': { const [, ...args] = command; actions.markPlayerDrafted(...args); break; }
      case 'recordProvisionalPick': { const [, ...args] = command; result = actions.recordProvisionalPick(...args); break; }
      case 'correctProvisionalPick': { const [, ...args] = command; result = actions.correctProvisionalPick(...args); break; }
      case 'removeProvisionalPick': { const [, ...args] = command; result = actions.removeProvisionalPick(...args); break; }
      case 'reconcileSyncedPicks': { const [, ...args] = command; result = actions.reconcileSyncedPicks(...args); break; }
      case 'preloadKeepers': { const [, ...args] = command; actions.preloadKeepers(...args); break; }
      case 'consumeKeeperAtCurrentPick': { const [, ...args] = command; actions.consumeKeeperAtCurrentPick(...args); break; }
      case 'undoLastPick': { const [, ...args] = command; actions.undoLastPick(...args); break; }
      case 'branchFromPick': { const [, ...args] = command; actions.branchFromPick(...args); break; }
      case 'resetDraft': { const [, ...args] = command; actions.resetDraft(...args); break; }
      case 'setMockSurvivalProbabilities': { const [, ...args] = command; actions.setMockSurvivalProbabilities(...args); break; }
      case 'togglePlayerShortlisted': { const [, ...args] = command; actions.togglePlayerShortlisted(...args); break; }
      case 'removePlayerFromShortlist': { const [, ...args] = command; actions.removePlayerFromShortlist(...args); break; }
      case 'addShortlistedPlayer': { if (!queue().includes(command[1])) actions.togglePlayerShortlisted(command[1]); break; }
      case 'moveShortlistedPlayerTo': { actions.moveShortlistedPlayer(command[1], command[2] - queue().indexOf(command[1])); break; }
      case 'moveShortlistedPlayer': { const [, ...args] = command; actions.moveShortlistedPlayer(...args); break; }
      case 'setDecisionLens': { const [, ...args] = command; actions.setDecisionLens(...args); break; }
      case 'setPositionFilter': { const [, ...args] = command; actions.setPositionFilter(...args); break; }
      case 'setSearchQuery': { const [, ...args] = command; actions.setSearchQuery(...args); break; }
  }
  return result;
}
