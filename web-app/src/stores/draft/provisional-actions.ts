import { getTeamIndexForPick } from '@/lib/mock-draft-engine';
import {
  getKeeperPickNumbers,
  restoreShortlistedPlayer,
  rebuildAfterProvisionalChange,
} from './state';
import type { DraftActions, SetDraftState } from './types';

export function createProvisionalActions(
  set: SetDraftState
): Pick<
  DraftActions,
  'recordProvisionalPick' |
  'correctProvisionalPick' |
  'removeProvisionalPick'
> {
  return {
    recordProvisionalPick: (pick) => {
      let recorded = false;
      set((state) => {
        const totalPicks = state.config.totalTeams * state.config.totalRounds;
        const expectedTeamIndex = getTeamIndexForPick(
          pick.pickNumber,
          state.config.totalTeams
        );
        const reservedKeeperPickNumbers = getKeeperPickNumbers(
          state.preloadedKeepers,
          state.config.totalTeams,
          state.config.draftType
        );
        const invalidPick =
          state.sessionMode !== 'live' ||
          !Number.isInteger(pick.pickNumber) ||
          pick.pickNumber < 1 ||
          pick.pickNumber > totalPicks ||
          pick.teamIndex !== expectedTeamIndex ||
          state.draftedPlayerIds.has(pick.playerId) ||
          reservedKeeperPickNumbers.has(pick.pickNumber) ||
          state.draftHistory.some((draftPick) =>
            draftPick.pickNumber === pick.pickNumber ||
            draftPick.playerId === pick.playerId
          );
        if (invalidPick) return;

        const shortlistIndex = state.shortlistedPlayerIds.indexOf(pick.playerId);
        if (shortlistIndex >= 0) {
          state.shortlistedPlayerIds.splice(shortlistIndex, 1);
        }
        state.draftHistory.push({
          ...pick,
          timestamp: Date.now(),
          source: 'provisional',
          ...(shortlistIndex >= 0 ? { shortlistIndex } : {}),
        });
        rebuildAfterProvisionalChange(state);
        recorded = true;
      });
      return recorded;
    },

    correctProvisionalPick: (originalPickNumber, replacement) => {
      let corrected = false;
      set((state) => {
        const originalIndex = state.draftHistory.findIndex(
          (pick) =>
            pick.pickNumber === originalPickNumber &&
            pick.source === 'provisional'
        );
        const original = state.draftHistory[originalIndex];
        if (!original || state.sessionMode !== 'live') return;

        const totalPicks = state.config.totalTeams * state.config.totalRounds;
        const expectedTeamIndex = getTeamIndexForPick(
          replacement.pickNumber,
          state.config.totalTeams
        );
        const keeperPlayerIds = new Set(
          state.preloadedKeepers.map((keeper) => keeper.playerId)
        );
        const reservedKeeperPickNumbers = getKeeperPickNumbers(
          state.preloadedKeepers,
          state.config.totalTeams,
          state.config.draftType
        );
        const duplicatesAnotherPick = state.draftHistory.some(
          (pick, index) =>
            index !== originalIndex &&
            (
              pick.pickNumber === replacement.pickNumber ||
              pick.playerId === replacement.playerId
            )
        );
        const invalidReplacement =
          !Number.isInteger(replacement.pickNumber) ||
          replacement.pickNumber < 1 ||
          replacement.pickNumber > totalPicks ||
          replacement.teamIndex !== expectedTeamIndex ||
          keeperPlayerIds.has(replacement.playerId) ||
          reservedKeeperPickNumbers.has(replacement.pickNumber) ||
          duplicatesAnotherPick;
        if (invalidReplacement) return;

        const isUnchanged =
          original.pickNumber === replacement.pickNumber &&
          original.playerId === replacement.playerId &&
          original.playerName === replacement.playerName &&
          original.position === replacement.position &&
          original.teamIndex === replacement.teamIndex &&
          original.teamName === replacement.teamName;
        if (isUnchanged) return;

        let shortlistIndex = original.shortlistIndex;
        if (original.playerId !== replacement.playerId) {
          restoreShortlistedPlayer(state.shortlistedPlayerIds, original);
          shortlistIndex = state.shortlistedPlayerIds.indexOf(
            replacement.playerId
          );
          if (shortlistIndex >= 0) {
            state.shortlistedPlayerIds.splice(shortlistIndex, 1);
          }
        }

        state.draftHistory[originalIndex] = {
          ...replacement,
          timestamp: original.timestamp,
          source: 'provisional',
          provisionalRevision: (original.provisionalRevision ?? 0) + 1,
          provisionalUpdatedAt: Date.now(),
          ...(shortlistIndex !== undefined && shortlistIndex >= 0
            ? { shortlistIndex }
            : {}),
        };
        rebuildAfterProvisionalChange(state);
        corrected = true;
      });
      return corrected;
    },

    removeProvisionalPick: (pickNumber) => {
      let removed = false;
      set((state) => {
        if (state.sessionMode !== 'live') return;
        const pickIndex = state.draftHistory.findIndex(
          (pick) =>
            pick.pickNumber === pickNumber && pick.source === 'provisional'
        );
        const pick = state.draftHistory[pickIndex];
        if (!pick) return;

        restoreShortlistedPlayer(state.shortlistedPlayerIds, pick);
        state.draftHistory.splice(pickIndex, 1);
        rebuildAfterProvisionalChange(state);
        removed = true;
      });
      return removed;
    },

  };
}
