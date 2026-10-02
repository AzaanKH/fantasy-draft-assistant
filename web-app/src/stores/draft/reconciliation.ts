import { getEffectiveKeeperAssignments, getKeeperPickNumber } from '@/lib/keeper-supply';
import {
  getKeeperPickNumbers,
  advancePastKeeperSlots,
  restoreShortlistedPlayer,
  rebuildCanonicalRosters,
} from './state';
import type {
  RecordedDraftPick,
  ReconciledDraftPick,
  UnresolvedProviderPick,
  DraftReconciliationResult,
  ProvisionalPickConfirmation,
  DraftPickCorrection,
  DraftPickRemoval,
} from './types';
import type { DraftActions, SetDraftState } from './types';

function hasSameCanonicalPick(
  left: RecordedDraftPick,
  right: RecordedDraftPick
): boolean {
  return (
    left.pickNumber === right.pickNumber &&
    left.playerId === right.playerId &&
    left.playerName === right.playerName &&
    left.position === right.position &&
    left.teamIndex === right.teamIndex &&
    left.teamName === right.teamName &&
    left.timestamp === right.timestamp &&
    left.source === right.source &&
    left.shortlistIndex === right.shortlistIndex &&
    left.provisionalRevision === right.provisionalRevision &&
    left.provisionalUpdatedAt === right.provisionalUpdatedAt
  );
}

function hasSameCanonicalHistory(
  left: readonly RecordedDraftPick[],
  right: readonly RecordedDraftPick[]
): boolean {
  return (
    left.length === right.length &&
    left.every((pick, index) => {
      const other = right[index];
      return other !== undefined && hasSameCanonicalPick(pick, other);
    })
  );
}

function toReconciledDraftPick(
  pick: ReconciledDraftPick
): ReconciledDraftPick {
  return {
    pickNumber: pick.pickNumber,
    playerId: pick.playerId,
    playerName: pick.playerName,
    position: pick.position,
    teamIndex: pick.teamIndex,
    teamName: pick.teamName,
  };
}

function hasSameProviderPick(
  left: ReconciledDraftPick,
  right: ReconciledDraftPick
): boolean {
  return (
    left.pickNumber === right.pickNumber &&
    left.playerId === right.playerId &&
    left.playerName === right.playerName &&
    left.position === right.position &&
    left.teamIndex === right.teamIndex &&
    left.teamName === right.teamName
  );
}

function hasSameUnresolvedProviderPicks(
  left: readonly UnresolvedProviderPick[],
  right: readonly UnresolvedProviderPick[]
): boolean {
  return (
    left.length === right.length &&
    left.every((pick, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        pick.pickNumber === other.pickNumber &&
        pick.playerId === other.playerId &&
        pick.playerName === other.playerName &&
        pick.nflTeam === other.nflTeam
      );
    })
  );
}

export function createReconciliationActions(
  set: SetDraftState
): Pick<
  DraftActions,

  'reconcileSyncedPicks'
> {
  return {
    reconcileSyncedPicks: (incomingPicks, nextPickNumber, unresolvedPicks = [], confirmedAt) => {
      let result: DraftReconciliationResult = {
        changed: false,
        confirmations: [],
        corrections: [],
        removals: [],
        unresolvedIdentities: [],
      };
      set((state) => {
        if (confirmedAt !== undefined && (!Number.isFinite(confirmedAt) || confirmedAt < 0 ||
            (state.lastConfirmedSyncAt !== null && confirmedAt < state.lastConfirmedSyncAt))) return;
        // An old cached history must not erase observations restored after an outage.
        if (state.manualContinuityBaselineAt !== null &&
            (confirmedAt === undefined || confirmedAt <= state.manualContinuityBaselineAt)) return;
        if (confirmedAt !== undefined && Number.isFinite(confirmedAt) && confirmedAt >= 0) {
          state.lastConfirmedSyncAt = confirmedAt;
          state.lastConfirmedPickNumber = Math.max(0, ...incomingPicks.map((pick) => pick.pickNumber), ...unresolvedPicks.map((pick) => pick.pickNumber));
          state.manualContinuityBaselineAt = null;
        }
        const effectiveKeepers = getEffectiveKeeperAssignments(
          state.preloadedKeepers,
          incomingPicks,
          state.config.totalTeams,
          state.config.draftType
        );
        const keeperPickKeys = new Set(
          effectiveKeepers.map((keeper) => `${keeper.playerId}:${String(
            getKeeperPickNumber(keeper, state.config.totalTeams, state.config.draftType)
          )}`)
        );
        const keeperPickNumbers = getKeeperPickNumbers(
          effectiveKeepers,
          state.config.totalTeams,
          state.config.draftType
        );
        const ordinaryIncomingPicks = incomingPicks
          .filter(
            (pick) =>
              !keeperPickKeys.has(`${pick.playerId}:${String(pick.pickNumber)}`)
          )
          .sort((left, right) => left.pickNumber - right.pickNumber);
        const canonicalUnresolvedPicks = unresolvedPicks
          .filter((pick) => !keeperPickNumbers.has(pick.pickNumber))
          .map((pick) => ({ ...pick }))
          .sort((left, right) => left.pickNumber - right.pickNumber);
        const remotePickNumbers = new Set(
          ordinaryIncomingPicks.map((pick) => pick.pickNumber)
        );
        const existingPicksByNumber = new Map(
          state.draftHistory.map((pick) => [pick.pickNumber, pick])
        );
        const confirmations: ProvisionalPickConfirmation[] = [];
        const corrections: DraftPickCorrection[] = [];
        for (const incoming of ordinaryIncomingPicks) {
          const existing = existingPicksByNumber.get(incoming.pickNumber);
          if (!existing) continue;

          if (
            existing.source === 'provisional' &&
            existing.playerId === incoming.playerId
          ) {
            confirmations.push(toReconciledDraftPick(incoming));
            continue;
          }

          if (!hasSameProviderPick(existing, incoming)) {
            corrections.push({
              pickNumber: incoming.pickNumber,
              previous: toReconciledDraftPick(existing),
              provider: toReconciledDraftPick(incoming),
            });
          }
        }
        const removals = state.draftHistory.flatMap(
          (pick): DraftPickRemoval[] => {
            if (
              remotePickNumbers.has(pick.pickNumber) ||
              (
                pick.source !== 'manual' &&
                pick.source !== 'provisional' &&
                pick.source !== 'sync'
              )
            ) {
              return [];
            }

            return [{
              ...toReconciledDraftPick(pick),
              source: pick.source,
            }];
          }
        );
        const reconciledAt = Date.now();
        const remotePicks: RecordedDraftPick[] = ordinaryIncomingPicks.map((pick) => {
          const existing = existingPicksByNumber.get(pick.pickNumber);
          const canReuseConfirmedPick =
            existing?.source === 'sync' &&
            existing.playerId === pick.playerId &&
            existing.playerName === pick.playerName &&
            existing.position === pick.position &&
            existing.teamIndex === pick.teamIndex &&
            existing.teamName === pick.teamName;
          if (canReuseConfirmedPick) return existing;

          return {
            pickNumber: pick.pickNumber,
            playerId: pick.playerId,
            playerName: pick.playerName,
            position: pick.position,
            teamIndex: pick.teamIndex,
            teamName: pick.teamName,
            timestamp: reconciledAt,
            source: 'sync',
          };
        });
        const draftHistory = remotePicks;
        const totalPicks = state.config.totalTeams * state.config.totalRounds;
        const canonicalNextPick = advancePastKeeperSlots(
          Math.min(totalPicks + 1, Math.max(1, Math.round(nextPickNumber))),
          effectiveKeepers,
          state.config.totalTeams,
          totalPicks,
          state.config.draftType
        );
        const historyChanged = !hasSameCanonicalHistory(
          state.draftHistory,
          draftHistory
        );
        const unresolvedIdentitiesChanged = !hasSameUnresolvedProviderPicks(
          state.unresolvedProviderPicks,
          canonicalUnresolvedPicks
        );
        if (
          !historyChanged &&
          !unresolvedIdentitiesChanged &&
          state.currentPick === canonicalNextPick
        ) {
          return;
        }

        for (const existing of state.draftHistory) {
          if (
            !ordinaryIncomingPicks.some(
              (incoming) => incoming.playerId === existing.playerId
            )
          ) {
            restoreShortlistedPlayer(state.shortlistedPlayerIds, existing);
          }
        }
        state.draftHistory = draftHistory;
        state.unresolvedProviderPicks = canonicalUnresolvedPicks;
        state.draftedPlayerIds = new Set([
          ...draftHistory.map((pick) => pick.playerId),
          ...effectiveKeepers.map((keeper) => keeper.playerId),
        ]);
        rebuildCanonicalRosters(state);
        state.shortlistedPlayerIds = state.shortlistedPlayerIds.filter(
          (playerId) => !state.draftedPlayerIds.has(playerId)
        );
        state.currentPick = canonicalNextPick;
        state.mockSurvivalProbabilities = {};
        result = {
          changed: true,
          confirmations,
          corrections,
          removals,
          unresolvedIdentities: unresolvedIdentitiesChanged
            ? canonicalUnresolvedPicks
            : [],
        };
      });
      return result;
    },

  };
}
