import { canonicalizeKeeperSupply, getEffectiveKeeperAssignments, getKeeperPickNumber } from '@/lib/keeper-supply';
import { addPlayerToRoster, advancePastKeeperSlots, rebuildCanonicalRosters } from './state';
import type { DraftActions, SetDraftState } from './types';

export function createPickActions(
  set: SetDraftState
): Pick<
  DraftActions,
  'markPlayerDrafted' |
  'preloadKeepers' |
  'consumeKeeperAtCurrentPick' |
  'undoLastPick' |
  'branchFromPick' |
  'addToMyRoster' |
  'resetDraft' |
  'setMockSurvivalProbabilities' |
  'togglePlayerShortlisted' |
  'removePlayerFromShortlist' |
  'moveShortlistedPlayer'
> {
  return {
    markPlayerDrafted: (playerId, playerName, position, teamIndex, teamName, pickNumber, source = 'manual') =>
      { set((state) => {
        const totalPicks = state.config.totalTeams * state.config.totalRounds;
        const pickNumberToUse = pickNumber ?? state.currentPick;

        if (pickNumberToUse < 1 || pickNumberToUse > totalPicks) {
          return;
        }

        if (state.draftedPlayerIds.has(playerId) && source !== 'keeper') {
          return;
        }

        if (pickNumber !== undefined) {
          const hasPick = state.draftHistory.some(
            (pick) => pick.pickNumber === pickNumberToUse
          );
          if (hasPick) return;
        }

        if (state.currentPick > totalPicks && pickNumber === undefined) {
          return;
        }

        const shortlistIndex = state.shortlistedPlayerIds.indexOf(playerId);
        state.draftedPlayerIds.add(playerId);
        if (shortlistIndex >= 0) {
          state.shortlistedPlayerIds.splice(shortlistIndex, 1);
        }
        state.draftHistory.push({
          pickNumber: pickNumberToUse,
          playerId,
          playerName,
          position,
          teamIndex,
          teamName,
          timestamp: Date.now(),
          source,
          ...(shortlistIndex >= 0 ? { shortlistIndex } : {}),
        });
        const teamRoster = state.teamRosters[teamIndex];
        if (teamRoster) addPlayerToRoster(teamRoster, position, playerId);
        if (pickNumber !== undefined) {
          state.currentPick = Math.max(state.currentPick, pickNumberToUse + 1);
        } else {
          state.currentPick += 1;
        }
        // The user's own pick resumes CPU auto-advance after an undo or pause.
        if (source === 'manual') state.mockAutoAdvance.paused = false;
        state.mockSurvivalProbabilities = {};
      }); },

    preloadKeepers: (keepers, supplyComplete = true) =>
      { set((state) => {
        // Canonical keeper supply: one deterministic assignment per kept
        // player at its configured team and round-selection cost, validated
        // before ordinary draft picks are applied.
        const supply = canonicalizeKeeperSupply(keepers, {
          totalTeams: state.config.totalTeams,
          totalRounds: state.config.totalRounds,
          draftType: state.config.draftType,
        });
        const supplyIsValid =
          supply.duplicatePlayerIds.length === 0 &&
          supply.invalidEntries.length === 0 &&
          supply.conflictingEntries.length === 0;
        const assignments = supplyIsValid && supplyComplete ? supply.assignments : [];
        const keeperPickKeys = new Set(
          assignments.map(
            (keeper) => `${keeper.playerId}:${String(keeper.pickNumber)}`
          )
        );
        state.draftHistory = state.draftHistory.filter(
          (pick) =>
            pick.source !== 'keeper' &&
            !keeperPickKeys.has(`${pick.playerId}:${String(pick.pickNumber)}`)
        );
        state.preloadedKeepers = assignments.map((keeper) => ({ ...keeper }));
        state.keepersInitialized = supplyIsValid && supplyComplete;
        const effectiveKeepers = getEffectiveKeeperAssignments(
          state.preloadedKeepers,
          state.draftHistory,
          state.config.totalTeams,
          state.config.draftType
        );
        state.draftedPlayerIds = new Set([
          ...state.draftHistory.map((pick) => pick.playerId),
          ...effectiveKeepers.map((keeper) => keeper.playerId),
        ]);
        rebuildCanonicalRosters(state);
        state.shortlistedPlayerIds = state.shortlistedPlayerIds.filter(
          (playerId) => !state.draftedPlayerIds.has(playerId)
        );
        if (state.sessionMode === 'live') {
          state.currentPick = advancePastKeeperSlots(
            state.currentPick,
            effectiveKeepers,
            state.config.totalTeams,
            state.config.totalTeams * state.config.totalRounds,
            state.config.draftType
          );
        }
        state.mockSurvivalProbabilities = {};
      }); },

    consumeKeeperAtCurrentPick: () =>
      { set((state) => {
        const keeper = state.preloadedKeepers.find(
          (candidate) => getKeeperPickNumber(candidate, state.config.totalTeams, state.config.draftType) === state.currentPick
        );
        if (!keeper) return;
        if (state.draftHistory.some((pick) => pick.pickNumber === state.currentPick)) return;
        // A legacy synced keeper may already exist at another slot. The
        // canonical keeper still owns this slot, so advance instead of stalling.
        if (state.draftHistory.some((pick) => pick.playerId === keeper.playerId)) {
          state.currentPick += 1;
          state.mockSurvivalProbabilities = {};
          return;
        }

        const isMyKeeper = keeper.teamIndex === state.config.myPickPosition - 1;
        state.draftHistory.push({
          pickNumber: state.currentPick,
          playerId: keeper.playerId,
          playerName: keeper.playerName,
          position: keeper.position,
          teamIndex: keeper.teamIndex,
          teamName: isMyKeeper ? 'My Team' : `Team ${String(keeper.teamIndex + 1)}`,
          timestamp: Date.now(),
          source: 'keeper',
        });
        state.draftedPlayerIds.add(keeper.playerId);
        state.currentPick += 1;
        state.mockSurvivalProbabilities = {};
      }); },

    undoLastPick: () =>
      { set((state) => {
        const lastPick = state.draftHistory.pop();
        if (lastPick) {
          const effectiveKeepers = getEffectiveKeeperAssignments(
            state.preloadedKeepers,
            state.draftHistory,
            state.config.totalTeams,
            state.config.draftType
          );
          state.draftedPlayerIds = new Set([
            ...state.draftHistory.map((pick) => pick.playerId),
            ...effectiveKeepers.map((keeper) => keeper.playerId),
          ]);
          if (
            lastPick.shortlistIndex !== undefined &&
            !state.shortlistedPlayerIds.includes(lastPick.playerId)
          ) {
            state.shortlistedPlayerIds.splice(
              Math.min(lastPick.shortlistIndex, state.shortlistedPlayerIds.length),
              0,
              lastPick.playerId
            );
          }
          rebuildCanonicalRosters(state);
          state.currentPick = Math.max(1, lastPick.pickNumber);
          state.mockSurvivalProbabilities = {};
          // Keep CPU auto-advance from re-drafting the restored pick.
          state.mockAutoAdvance.paused = true;
        }
      }); },

    branchFromPick: (pickNumber) =>
      { set((state) => {
        const totalPicks = state.config.totalTeams * state.config.totalRounds;
        const branchPick = Math.min(totalPicks + 1, Math.max(1, Math.round(pickNumber)));
        state.draftHistory = state.draftHistory.filter(
          (pick) => pick.pickNumber < branchPick
        );
        const effectiveKeepers = getEffectiveKeeperAssignments(
          state.preloadedKeepers,
          state.draftHistory,
          state.config.totalTeams,
          state.config.draftType
        );
        state.draftedPlayerIds = new Set([
          ...effectiveKeepers.map((keeper) => keeper.playerId),
          ...state.draftHistory.map((pick) => pick.playerId),
        ]);
        rebuildCanonicalRosters(state);
        state.shortlistedPlayerIds = state.shortlistedPlayerIds.filter(
          (playerId) => !state.draftedPlayerIds.has(playerId)
        );
        state.currentPick = branchPick;
        state.mockSurvivalProbabilities = {};
        state.mockAutoAdvance.paused = true;
      }); },

    addToMyRoster: (player) =>
      { set((state) => {
        const position = player.position;
        addPlayerToRoster(state.myRoster, position, player.id);
        const teamRoster = state.teamRosters[state.config.myPickPosition - 1];
        if (teamRoster) addPlayerToRoster(teamRoster, position, player.id);
      }); },

    resetDraft: () =>
      { set((state) => {
        state.currentPick = 1;
        state.draftedPlayerIds = new Set(
          state.preloadedKeepers.map((keeper) => keeper.playerId)
        );
        state.draftHistory = [];
        state.unresolvedProviderPicks = [];
        state.manualContinuityBaselineAt = null;
        state.lastConfirmedSyncAt = null;
        state.lastConfirmedPickNumber = 0;
        rebuildCanonicalRosters(state);
        state.shortlistedPlayerIds = [];
        state.mockSurvivalProbabilities = {};
        state.mockAutoAdvance.paused = false;
      }); },

    setMockSurvivalProbabilities: (probabilities) => {
      set((state) => {
        state.mockSurvivalProbabilities = { ...probabilities };
      });
    },

    togglePlayerShortlisted: (playerId) => {
      set((state) => {
        const index = state.shortlistedPlayerIds.indexOf(playerId);
        if (index >= 0) {
          state.shortlistedPlayerIds.splice(index, 1);
          return;
        }

        if (!state.draftedPlayerIds.has(playerId)) {
          state.shortlistedPlayerIds.push(playerId);
        }
      });
    },

    removePlayerFromShortlist: (playerId) => {
      set((state) => {
        state.shortlistedPlayerIds = state.shortlistedPlayerIds.filter(
          (shortlistedPlayerId) => shortlistedPlayerId !== playerId
        );
      });
    },

    moveShortlistedPlayer: (playerId, offset) => {
      set((state) => {
        const index = state.shortlistedPlayerIds.indexOf(playerId);
        const target = index + offset;
        if (index < 0 || target < 0 || target >= state.shortlistedPlayerIds.length) return;
        state.shortlistedPlayerIds.splice(index, 1);
        state.shortlistedPlayerIds.splice(target, 0, playerId);
      });
    },

  };
}
