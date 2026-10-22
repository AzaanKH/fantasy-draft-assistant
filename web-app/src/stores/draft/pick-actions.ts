import { deriveDraftCursor, canonicalizeKeeperSupply, getEffectiveKeeperAssignments, getKeeperPickNumber, createSlotSequence } from '@fantasy-draft/shared/draft';
import { deriveDraftState } from './source';
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
  'resetDraft' |
  'setMockSurvivalProbabilities' |
  'togglePlayerShortlisted' |
  'removePlayerFromShortlist' |
  'moveShortlistedPlayer'
> {
  return {
    markPlayerDrafted: (playerId, playerName, position, teamIndex, teamName, pickNumber, source = 'manual', expected) =>
      { set((state) => {
        const totalPicks = state.config.totalTeams * state.config.totalRounds;
        const view = deriveDraftState(state);
        const pickNumberToUse = pickNumber ?? view.currentPick;
        if (expected && (view.currentPick !== expected.pickNumber || state.sessionMode !== 'mock' ||
            createSlotSequence({ type: state.config.draftType, teams: state.config.totalTeams, rounds: state.config.totalRounds }).at(view.currentPick).teamIndex !== teamIndex ||
            (expected.actor === 'user' ? !view.canDraftByPosition[position] : view.isMyTurn) || view.draftedPlayerIds.has(playerId))) {
          throw new Error('The draft changed before this selection was saved. Review the current pick and retry.');
        }

        if (pickNumberToUse < 1 || pickNumberToUse > totalPicks) {
          return;
        }

        if (view.draftedPlayerIds.has(playerId) && source !== 'keeper') {
          return;
        }

        if (pickNumber !== undefined) {
          const hasPick = state.draftHistory.some(
            (pick) => pick.pickNumber === pickNumberToUse
          );
          if (hasPick) return;
        }

        if (view.currentPick > totalPicks && pickNumber === undefined) {
          return;
        }

        const shortlistIndex = state.shortlistedPlayerIds.indexOf(playerId);
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
        // The user's own pick resumes CPU auto-advance after an undo or pause.
        if (source === 'manual') state.mockAutoAdvance.paused = false;
        state.mockSurvivalProbabilities = {};
      }); },

    preloadKeepers: (keepers, supplyComplete = true) =>
      { set((state) => {
        // Canonical keeper supply: one deterministic assignment per kept
        // player at its configured team and round-selection cost, validated
        // before ordinary draft picks are applied.
        const fromPick = deriveDraftCursor(state.draftHistory, state.draftProgress);
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
        state.shortlistedPlayerIds = [...deriveDraftState(state).shortlistedPlayerIds];
        const effectiveKeepers = getEffectiveKeeperAssignments(
          state.preloadedKeepers,
          state.draftHistory,
          state.config.totalTeams,
          state.config.draftType
        );
        state.draftProgress = {
          historyLength: state.draftHistory.length,
          anchor: state.sessionMode === 'live'
            ? { kind: 'past-keepers', fromPick,
                keeperSlots: effectiveKeepers.map(keeper => getKeeperPickNumber(keeper, state.config.totalTeams, state.config.draftType)),
                totalPicks: state.config.totalTeams * state.config.totalRounds }
            : { kind: 'carry', pickNumber: fromPick },
        };
        state.mockSurvivalProbabilities = {};
      }); },

    consumeKeeperAtCurrentPick: (expectedPickNumber) =>
      { set((state) => {
        const { currentPick } = deriveDraftState(state);
        if (expectedPickNumber !== undefined && currentPick !== expectedPickNumber) throw new Error('The draft advanced before the keeper could be recorded.');
        const keeper = state.preloadedKeepers.find(
          (candidate) => getKeeperPickNumber(candidate, state.config.totalTeams, state.config.draftType) === currentPick
        );
        if (!keeper) return;
        if (state.draftHistory.some((pick) => pick.pickNumber === currentPick)) return;
        // A legacy synced keeper may already exist at another slot. The
        // canonical keeper still owns this slot, so advance instead of stalling.
        if (state.draftHistory.some((pick) => pick.playerId === keeper.playerId)) {
          state.draftProgress = {
            anchor: { kind: 'carry', pickNumber: deriveDraftCursor(state.draftHistory, state.draftProgress) + 1 },
            historyLength: state.draftHistory.length,
          };
          state.mockSurvivalProbabilities = {};
          return;
        }

        const isMyKeeper = keeper.teamIndex === state.config.myPickPosition - 1;
        state.draftHistory.push({
          pickNumber: currentPick,
          playerId: keeper.playerId,
          playerName: keeper.playerName,
          position: keeper.position,
          teamIndex: keeper.teamIndex,
          teamName: isMyKeeper ? 'My Team' : `Team ${String(keeper.teamIndex + 1)}`,
          timestamp: Date.now(),
          source: 'keeper',
        });
        state.mockSurvivalProbabilities = {};
      }); },

    undoLastPick: () =>
      { set((state) => {
        const lastPick = state.draftHistory.pop();
        if (lastPick) {
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
          state.draftProgress = {
            anchor: { kind: 'reopen', pickNumber: lastPick.pickNumber },
            historyLength: state.draftHistory.length,
          };
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
        state.shortlistedPlayerIds = [...deriveDraftState(state).shortlistedPlayerIds];
        state.draftProgress = {
          anchor: { kind: 'branch', pickNumber: branchPick },
          historyLength: state.draftHistory.length,
        };
        state.mockSurvivalProbabilities = {};
        state.mockAutoAdvance.paused = true;
      }); },

    resetDraft: () =>
      { set((state) => {
        state.draftProgress = { anchor: { kind: 'start' }, historyLength: 0 };
        state.draftHistory = [];
        state.unresolvedProviderPicks = [];
        state.manualContinuityBaselineAt = null;
        state.lastConfirmedSyncAt = null;
        state.lastConfirmedPickNumber = 0;
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

        if (!deriveDraftState(state).draftedPlayerIds.has(playerId)) {
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
