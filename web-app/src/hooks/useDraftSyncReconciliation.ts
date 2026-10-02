import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DraftProvider, DraftSyncSnapshot } from '@fantasy-draft/shared';
import { useLeagueSetupStore } from '@/stores/leagueSetupStore';
import { useDraftSyncConnectionStore } from '@/stores/draftSyncStore';
import { useDraftStore } from '@/stores/draftStore';
import { resolveSyncedLeagueSettings } from '@/lib/synced-league-settings';
import {
  getNextOpenPickNumber,
  resolveDraftPickImports,
  type DraftPickImportRejection,
  type DraftPickImportResult,
} from '@/lib/draft-pick-imports';
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

export function useDraftSyncReconciliation(provider: DraftProvider, draftId: string | null, snapshot: DraftSyncSnapshot | null, shouldImportPicks: boolean) {
  const quickMockPreferences = useLeagueSetupStore((state) => state.quickMock);
  const useQuickMockSettings = useDraftSyncConnectionStore((state) =>
    state.connection?.provider === provider && state.connection.draftId === draftId && state.connection.settingsProfile === 'quick-mock'
  );
  const usePrimaryLeagueSettings = useDraftSyncConnectionStore((state) =>
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
    draftId: string;
    picks: DraftSyncSnapshot['picks'];
    importedPicks: DraftPickImportResult['picks'];
    rejectedPicks: DraftPickImportResult['rejectedPicks'];
    nextOpenPickNumber: number;
  } | null>(null);
  const reconcileSyncedPicks = useDraftStore((state) => state.reconcileSyncedPicks);
  const manualContinuityBaselineAt = useDraftStore((state) => state.manualContinuityBaselineAt);
  const lastConfirmedSyncAt = useDraftStore((state) => state.lastConfirmedSyncAt);
  const myPickPosition = useDraftStore((state) => state.config.myPickPosition);
  const totalTeams = useDraftStore((state) => state.config.totalTeams);
  const preloadedKeepers = useDraftStore((state) => state.preloadedKeepers);
  const setConfig = useDraftStore((state) => state.setConfig);
  const applyLeagueSettings = useDraftStore((state) => state.applyLeagueSettings);

  useEffect(() => {
    setLastReconciledSnapshotAt(null);
    setReconciliationSummary(null);
  }, [draftId, provider]);

  useEffect(() => {
    if (!snapshot?.draft) {
      return;
    }

    setConfig({
      totalTeams: snapshot.draft.settings.teams,
      totalRounds: snapshot.draft.settings.rounds,
      draftType: snapshot.draft.type,
    });
    applyLeagueSettings(resolveSyncedLeagueSettings(
      provider,
      snapshot.draft.settings.teams,
      snapshot.draft.leagueSettings,
      usePrimaryLeagueSettings,
      useQuickMockSettings ? { ...quickMockPreferences, totalRounds: snapshot.draft.settings.rounds } : undefined,
    ));
  }, [applyLeagueSettings, setConfig, snapshot?.draft, provider, usePrimaryLeagueSettings, useQuickMockSettings, quickMockPreferences]);

  const pickHistory = snapshot?.picks;
  const draftSettings = snapshot?.draft?.settings;
  const draftType = snapshot?.draft?.type;

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
      lastImported.current = null;
      return;
    }

    const previousImport = lastImported.current;
    if (
      previousImport?.draftId === draftId &&
      previousImport.picks === snapshot.picks &&
      previousImport.importedPicks === importResult.picks &&
      previousImport.rejectedPicks === importResult.rejectedPicks &&
      previousImport.nextOpenPickNumber === nextOpenPickNumber
    ) {
      setLastReconciledSnapshotAt(snapshot.lastSuccessfulSyncAt);
      return;
    }

    const reconciliation = reconcileSyncedPicks(
      importResult.picks,
      nextOpenPickNumber,
      importResult.rejectedPicks,
      snapshot.lastSuccessfulSyncAt
    );
    lastImported.current = {
      draftId: snapshot.draftId,
      picks: snapshot.picks,
      importedPicks: importResult.picks,
      rejectedPicks: importResult.rejectedPicks,
      nextOpenPickNumber,
    };
    const hasVisibleOutcome =
      reconciliation.confirmations.length > 0 ||
      reconciliation.corrections.length > 0 ||
      reconciliation.removals.length > 0 ||
      reconciliation.unresolvedIdentities.length > 0;
    if (hasVisibleOutcome) {
      setReconciliationSummary({
        confirmedAt: snapshot.lastSuccessfulSyncAt,
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
  }, [
    draftId,
    snapshot,
    shouldImportPicks,
    manualContinuityBaselineAt,
    lastConfirmedSyncAt,
    isPlayerDataLoading,
    importResult.picks,
    importResult.rejectedPicks,
    nextOpenPickNumber,
    reconcileSyncedPicks,
  ]);

  const dismissReconciliationSummary = useCallback(() => {
    setReconciliationSummary(null);
  }, []);

  return { importResult, importWarning: getImportWarning(importResult.rejectedPicks), lastReconciledSnapshotAt, reconciliationSummary, dismissReconciliationSummary };
}
