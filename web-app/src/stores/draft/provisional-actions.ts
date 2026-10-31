import { deriveDraftState } from './source';
import { createSlotSequence } from '@fantasy-draft/shared/draft';
import {
  getKeeperPickNumbers,
  restoreShortlistedPlayer,
  acceptProvisionalProgress,
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
      const outcome = set((state) => {
        const totalPicks = state.config.totalTeams * state.config.totalRounds;
        if (!Number.isInteger(pick.pickNumber) || pick.pickNumber < 1 || pick.pickNumber > totalPicks) return false;
        const expectedTeamIndex = createSlotSequence({ type: state.config.draftType, teams: state.config.totalTeams, rounds: state.config.totalRounds }).at(pick.pickNumber).teamIndex;
        const reservedKeeperPickNumbers = getKeeperPickNumbers(
          state.preloadedKeepers,
          state.config.totalTeams,
          state.config.draftType
        );
        const invalidPick =
          state.sessionMode !== 'live' ||
          pick.teamIndex !== expectedTeamIndex ||
          deriveDraftState(state).draftedPlayerIds.has(pick.playerId) ||
          reservedKeeperPickNumbers.has(pick.pickNumber) ||
          state.draftHistory.some((draftPick) =>
            draftPick.pickNumber === pick.pickNumber ||
            draftPick.playerId === pick.playerId
          );
        if (invalidPick) return false;

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
        acceptProvisionalProgress(state);
        return true;
      });
      return outcome.status === 'committed' && outcome.result;
    },

    correctProvisionalPick: (originalPickNumber, replacement) => {
      const outcome = set((state) => {
        const originalIndex = state.draftHistory.findIndex(
          (pick) =>
            pick.pickNumber === originalPickNumber &&
            pick.source === 'provisional'
        );
        const original = state.draftHistory[originalIndex];
        if (!original || state.sessionMode !== 'live') return false;

        const totalPicks = state.config.totalTeams * state.config.totalRounds;
        if (!Number.isInteger(replacement.pickNumber) || replacement.pickNumber < 1 || replacement.pickNumber > totalPicks) return false;
        const expectedTeamIndex = createSlotSequence({ type: state.config.draftType, teams: state.config.totalTeams, rounds: state.config.totalRounds }).at(replacement.pickNumber).teamIndex;
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
          replacement.teamIndex !== expectedTeamIndex ||
          keeperPlayerIds.has(replacement.playerId) ||
          reservedKeeperPickNumbers.has(replacement.pickNumber) ||
          duplicatesAnotherPick;
        if (invalidReplacement) return false;

        const isUnchanged =
          original.pickNumber === replacement.pickNumber &&
          original.playerId === replacement.playerId &&
          original.playerName === replacement.playerName &&
          original.position === replacement.position &&
          original.teamIndex === replacement.teamIndex &&
          original.teamName === replacement.teamName;
        if (isUnchanged) return false;

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
        acceptProvisionalProgress(state);
        return true;
      });
      return outcome.status === 'committed' && outcome.result;
    },

    removeProvisionalPick: (pickNumber) => {
      const outcome = set((state) => {
        if (state.sessionMode !== 'live') return false;
        const pickIndex = state.draftHistory.findIndex(
          (pick) =>
            pick.pickNumber === pickNumber && pick.source === 'provisional'
        );
        const pick = state.draftHistory[pickIndex];
        if (!pick) return false;

        restoreShortlistedPlayer(state.shortlistedPlayerIds, pick);
        state.draftHistory.splice(pickIndex, 1);
        acceptProvisionalProgress(state);
        return true;
      });
      return outcome.status === 'committed' && outcome.result;
    },

  };
}
