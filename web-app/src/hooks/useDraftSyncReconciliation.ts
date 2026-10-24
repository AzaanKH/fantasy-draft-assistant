import { STORAGE_ACTIVATION_ENABLED } from '@fantasy-draft/shared/sync';
import { dispatchWorkspace, requestWorkspace } from '@/workspace/ui-dispatch';
import type { DraftReconciliationResult } from '@/stores/draft/types';
import { useWorkspace, useConnectionState, useDraftState } from '@/workspace/WorkspaceProvider';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DraftProvider, DraftSyncSnapshot } from '@fantasy-draft/shared/sync';
import { useLeagueSetupStore } from '@/stores/leagueSetupStore';
import { resolveSyncedLeagueSettings } from '@/lib/synced-league-settings';
import {
  getNextOpenPickNumber,
  resolveDraftPickImports,
  type DraftPickImportRejection,
  type DraftPickImportResult,
} from '@fantasy-draft/shared/draft';
import type { DraftReconciliationSummary } from '@/lib/draft-sync-state';
import { usePlayerDataQuery } from './usePlayerData';

const EMPTY_IMPORT_RESULT: DraftPickImportResult = { picks: [], rejectedPicks: [] };

function getImportWarning(
  rejectedPicks: readonly DraftPickImportRejection[]
): string | null {
  if (rejectedPicks.length === 0) {
    return null;
  }

  const examples = rejectedPicks
    .slice(0, 3)
    .map((pick) => `#${String(pick.pickNumber)} ${pick.playerName}`)
    .join(', ');
  const remaining =
    rejectedPicks.length > 3
      ? `, and ${String(rejectedPicks.length - 3)} more`
      : '';
  const subject =
    rejectedPicks.length === 1
      ? 'This pick was'
      : 'These picks were';

  return `${String(rejectedPicks.length)} ${
    rejectedPicks.length === 1 ? 'pick was' : 'picks were'
  } not imported because Provider Truth could not map the player to canonical identity data (${examples}${remaining}). ${subject} excluded from roster and availability calculations. Live recommendations stay off until player identities are refreshed and the provider sync succeeds.`;
}

export function useDraftSyncReconciliation(provider: DraftProvider, draftId: string | null, snapshot: DraftSyncSnapshot | null, shouldImportPicks: boolean): {
  importResult: DraftPickImportResult;
  importWarning: string | null;
  lastReconciledSnapshotAt: number | null;
  reconciliationSummary: DraftReconciliationSummary | null;
  dismissReconciliationSummary: () => void;
} {
  const quickMockPreferences = useLeagueSetupStore((state) => state.quickMock);
  const useQuickMockSettings = useConnectionState((state) =>
    state.connection?.provider === provider && state.connection.draftId === draftId && state.connection.settingsProfile === 'quick-mock'
  );
  const usePrimaryLeagueSettings = useConnectionState((state) =>
    provider === 'sleeper' && state.connection?.provider === provider &&
    state.connection.draftId === draftId && state.connection.usePrimaryLeagueSettings === true
  );
  const {
    players,
    isLoading: isPlayerDataLoading,
  } = usePlayerDataQuery();
  const [lastReconciledSnapshotAt, setLastReconciledSnapshotAt] = useState<
    number | null
  >(null);
  const [reconciliationSummary, setReconciliationSummary] = useState<
    DraftReconciliationSummary | null
  >(null);
  const lastImported = useRef<{
    key: string;
    picks: DraftSyncSnapshot['picks'];
    importedPicks: DraftPickImportResult['picks'];
    rejectedPicks: DraftPickImportResult['rejectedPicks'];
  } | null>(null);
  const inFlight = useRef<string | null>(null);
  const currentIdentity = useRef({ provider, draftId });
  currentIdentity.current = { provider, draftId };
  const workspace = useWorkspace();
  const manualContinuityBaselineAt = useDraftState((state) => state.manualContinuityBaselineAt);
  const lastConfirmedSyncAt = useDraftState((state) => state.lastConfirmedSyncAt);
  const myPickPosition = useDraftState((state) => state.config.myPickPosition);
  const totalTeams = useDraftState((state) => state.config.totalTeams);
  const configuredDraftType = useDraftState((state) => state.config.draftType);
  const preloadedKeepers = useDraftState((state) => state.preloadedKeepers);

  useEffect(() => {
    setLastReconciledSnapshotAt(null);
    setReconciliationSummary(null);
  }, [draftId, provider]);

  useEffect(() => {
    if (!snapshot?.draft) {
      return;
    }

    if (STORAGE_ACTIVATION_ENABLED) { dispatchWorkspace(workspace, 'setConfig', {
      totalTeams: snapshot.draft.settings.teams,
      totalRounds: snapshot.draft.settings.rounds,
      draftType: snapshot.draft.type,
    }); } else { workspace.send('setConfig', {
      totalTeams: snapshot.draft.settings.teams,
      totalRounds: snapshot.draft.settings.rounds,
      draftType: snapshot.draft.type,
    }); }
    if (STORAGE_ACTIVATION_ENABLED) { dispatchWorkspace(workspace, 'applyLeagueSettings', resolveSyncedLeagueSettings(
      provider,
      snapshot.draft.settings.teams,
      snapshot.draft.leagueSettings,
      usePrimaryLeagueSettings,
      useQuickMockSettings ? { ...quickMockPreferences, totalRounds: snapshot.draft.settings.rounds } : undefined,
    )); } else { workspace.send('applyLeagueSettings', resolveSyncedLeagueSettings(
      provider,
      snapshot.draft.settings.teams,
      snapshot.draft.leagueSettings,
      usePrimaryLeagueSettings,
      useQuickMockSettings ? { ...quickMockPreferences, totalRounds: snapshot.draft.settings.rounds } : undefined,
    )); }
  }, [workspace, snapshot?.draft, provider, usePrimaryLeagueSettings, useQuickMockSettings, quickMockPreferences]);

  const pickHistory = snapshot?.picks;
  const draftSettings = snapshot?.draft?.settings;
  const draftType = snapshot?.draft?.type ?? configuredDraftType;

  const importResult = useMemo(() => {
    if (!pickHistory || isPlayerDataLoading) {
      return EMPTY_IMPORT_RESULT;
    }

    return resolveDraftPickImports(
      pickHistory,
      players,
      myPickPosition,
      preloadedKeepers,
      totalTeams,
      draftType
    );
  }, [
    pickHistory,
    isPlayerDataLoading,
    players,
    myPickPosition,
    preloadedKeepers,
    totalTeams,
    draftType,
  ]);

  const nextOpenPickNumber = useMemo(() => {
    if (!pickHistory || !draftSettings) {
      return 1;
    }

    return getNextOpenPickNumber(
      pickHistory,
      draftSettings.teams * draftSettings.rounds
    );
  }, [pickHistory, draftSettings]);

  useEffect(() => {
    if (
      !snapshot ||
      snapshot.status !== 'synced' ||
      snapshot.lastSuccessfulSyncAt === null ||
      (manualContinuityBaselineAt !== null && snapshot.lastSuccessfulSyncAt <= manualContinuityBaselineAt) ||
      (lastConfirmedSyncAt !== null && snapshot.lastSuccessfulSyncAt < lastConfirmedSyncAt) ||
      !shouldImportPicks ||
      isPlayerDataLoading
    ) {
      if (!(STORAGE_ACTIVATION_ENABLED && workspace.sendDurable) || !shouldImportPicks || manualContinuityBaselineAt !== null) lastImported.current = null;
      return;
    }

    const requestKey = JSON.stringify({ provider, draftId, picks: importResult.picks, rejected: importResult.rejectedPicks,
      nextOpenPickNumber });
    const previous = lastImported.current;
    const alreadyImported = previous?.key === requestKey && ((STORAGE_ACTIVATION_ENABLED && workspace.sendDurable !== undefined) ||
      (previous.picks === snapshot.picks && previous.importedPicks === importResult.picks && previous.rejectedPicks === importResult.rejectedPicks));
    if (alreadyImported) {
      if (STORAGE_ACTIVATION_ENABLED && workspace.sendDurable && snapshot.lastSuccessfulSyncAt > (lastConfirmedSyncAt ?? -1)) {
        const confirmedAt = snapshot.lastSuccessfulSyncAt;
        void workspace.sendDurable(['advanceSyncFreshness', confirmedAt]).then(() => {
          if (currentIdentity.current.provider === provider && currentIdentity.current.draftId === draftId) setLastReconciledSnapshotAt(confirmedAt);
        }).catch(() => undefined);
      } else setLastReconciledSnapshotAt(snapshot.lastSuccessfulSyncAt);
      return;
    }
    if (inFlight.current === requestKey) return;
    inFlight.current = requestKey;
    const confirmedAt = snapshot.lastSuccessfulSyncAt;
    const applyReceipt = (reconciliation: DraftReconciliationResult): void => {
      if (inFlight.current === requestKey) inFlight.current = null;
      if (currentIdentity.current.provider !== provider || currentIdentity.current.draftId !== draftId || reconciliation.refused) return;
      lastImported.current = { key: requestKey, picks: snapshot.picks, importedPicks: importResult.picks, rejectedPicks: importResult.rejectedPicks };
      const hasVisibleOutcome =
        reconciliation.confirmations.length > 0 ||
        reconciliation.corrections.length > 0 ||
        reconciliation.removals.length > 0 ||
        reconciliation.unresolvedIdentities.length > 0;
      if (hasVisibleOutcome) {
        setReconciliationSummary({
          confirmedAt,
          confirmations: reconciliation.confirmations,
          corrections: reconciliation.corrections,
          removals: reconciliation.removals,
          unresolvedIdentities: importResult.rejectedPicks,
        });
      } else if (
        reconciliation.changed &&
        importResult.rejectedPicks.length === 0
      ) {
        setReconciliationSummary((current) =>
          current && current.unresolvedIdentities.length > 0 ? null : current
        );
      }
      setLastReconciledSnapshotAt(snapshot.lastSuccessfulSyncAt);
    };
    try {
      const receipt = (STORAGE_ACTIVATION_ENABLED ? requestWorkspace(workspace, 'reconcileSyncedPicks', importResult.picks, nextOpenPickNumber, importResult.rejectedPicks, snapshot.lastSuccessfulSyncAt) : workspace.send('reconcileSyncedPicks', importResult.picks, nextOpenPickNumber, importResult.rejectedPicks, snapshot.lastSuccessfulSyncAt));
      if (receipt instanceof Promise) void receipt.then(applyReceipt).catch(() => { if (inFlight.current === requestKey) inFlight.current = null; });
      else applyReceipt(receipt);
    } catch (error) {
      if (inFlight.current === requestKey) inFlight.current = null;
      throw error;
    }
  }, [
    provider,
    draftId,
    snapshot,
    shouldImportPicks,
    manualContinuityBaselineAt,
    lastConfirmedSyncAt,
    isPlayerDataLoading,
    importResult.picks,
    importResult.rejectedPicks,
    nextOpenPickNumber,
    workspace,
  ]);

  const dismissReconciliationSummary = useCallback(() => {
    setReconciliationSummary(null);
  }, []);

  return { importResult, importWarning: getImportWarning(importResult.rejectedPicks), lastReconciledSnapshotAt, reconciliationSummary, dismissReconciliationSummary };
}
