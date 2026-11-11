/**
 * Guides the user through connecting a provider draft and keeps the live sync
 * state visible while they use the draft board. Parsing lives in
 * draft-connect-parsing.ts, panels in DraftConnectPanels.tsx, and dialog step
 * bodies in DraftConnectSteps.tsx; this file owns state and the three variants.
 */
import * as React from 'react';
import { Link2, Settings2 } from 'lucide-react';
import { sendWorkspaceCommand } from '@/workspace/workspace-command';
import { useNow } from '@/workspace/useNow';
import { useWorkspace, useDraftState } from '@/workspace/WorkspaceProvider';
import { useLeagueSetupStore } from '@/stores/leagueSetupStore';
import { DraftReadinessBlockedNotice } from '@/features/draft-room/DraftReadinessBlockedNotice';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { DraftReadinessReport } from '@fantasy-draft/shared/catalog';
import type { DraftProvider } from '@fantasy-draft/shared/sync';
import { cn } from '@/lib/utils';
import type { DataFreshnessItem } from '@/lib/data-freshness';
import { DraftSyncStatusIndicator } from '@/features/draft-room/DraftSyncStatusIndicator';
import { useLiveDraftSync } from '@/features/draft-room/LiveDraftSyncProvider';
import { providerLabel as labelForProvider, validateDraftInput } from './draft-connect-parsing';
import {
  DataConfidenceSummary,
  OptionalSignalPanel,
  ReadinessWarningPanel,
  type SyncConfidence,
} from './DraftConnectPanels';
import {
  ConnectedSyncStep,
  ConnectingStep,
  DraftEntryStep,
  DraftSlotStep,
  PracticeSettingsControl,
  SyncErrorStep,
} from './DraftConnectSteps';
import { DraftConnectSummaryRow } from './DraftConnectSummaryRow';

interface DraftConnectProps {
  fantasyProsRefreshedAt?: string;
  sleeperFetchedAt?: string;
  fantasyProsSourceType?: string;
  predictionModelVersion?: string;
  predictionGeneratedAt?: string | null;
  shadowRecommendationAvailable?: boolean;
  recommendationPolicyReason?: string;
  dataFreshness: readonly DataFreshnessItem[];
  readiness: DraftReadinessReport;
  variant?: 'card' | 'strip' | 'status-control';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function DraftConnect({
  fantasyProsRefreshedAt,
  sleeperFetchedAt,
  fantasyProsSourceType,
  predictionModelVersion,
  predictionGeneratedAt,
  shadowRecommendationAvailable = false,
  recommendationPolicyReason,
  dataFreshness,
  readiness,
  variant = 'card',
  open,
  onOpenChange,
}: DraftConnectProps): React.ReactElement {
  const {
    connection,
    sync,
    synchronizationState,
    viewState: syncViewState,
    startConnection,
    confirmDraftPosition,
    disconnect,
  } = useLiveDraftSync();
  const localProfile = useLeagueSetupStore((state) => state.profile);
  const quickMockPreferences = useLeagueSetupStore((state) => state.quickMock);
  const [pendingSettingsProfile, setPendingSettingsProfile] = React.useState('provider');
  const workspace = useWorkspace();

  const [localDialogOpen, setLocalDialogOpen] = React.useState(false);
  const isDialogOpen = open ?? localDialogOpen;
  const setIsDialogOpen = onOpenChange ?? setLocalDialogOpen;
  React.useEffect(() => {
    if (isDialogOpen && !connection) setPendingSettingsProfile(localProfile === 'quick-mock' ? 'quick-mock' : 'provider');
  }, [isDialogOpen, connection, localProfile]);
  const [provider, setProvider] = React.useState<DraftProvider>(
    connection?.provider ?? 'sleeper'
  );
  const [draftIdInput, setDraftIdInput] = React.useState(
    connection?.draftId ?? ''
  );
  const [draftInputError, setDraftInputError] = React.useState<string | null>(null);
  const draftInputRef = React.useRef<HTMLInputElement>(null);
  const [draftPosition, setDraftPosition] = React.useState(
    connection?.draftPosition === null || connection === null
      ? '1'
      : String(connection.draftPosition)
  );
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [isReadinessDrawerOpen, setIsReadinessDrawerOpen] = React.useState(false);
  const [isOptionalSignalsExpanded, setIsOptionalSignalsExpanded] = React.useState(false);
  const now = useNow();
  const isStrip = variant === 'strip';

  const myPickPosition = useDraftState((state) => state.config.myPickPosition);
  const leagueSettings = useDraftState((state) => state.leagueSettings);
  const connectedDraftId = connection?.draftId ?? null;
  const isDraftPositionConfirmed =
    connection !== null && connection.draftPosition !== null;

  const {
    draft,
    totalPicks,
    myPicksCount,
    isError: hasSnapshotError,
    lastError,
    connectionState,
    isDrafting,
    isPaused,
    isComplete,
    importWarning,
    rejectedPickCount,
    refresh,
  } = sync;
  const lastSyncAgeMs = sync.lastSuccessfulSyncAt === null ? null : Math.max(0, now - sync.lastSuccessfulSyncAt);
  const isError = hasSnapshotError || connectionState === 'error';

  React.useEffect(() => {
    if (!connection) return;
    setProvider(connection.provider);
    setDraftIdInput(connection.draftId);
    if (connection.draftPosition !== null) {
      setDraftPosition(String(connection.draftPosition));
    }
  }, [connection]);

  const isConnecting =
    connectedDraftId !== null && !draft && !isError;
  const hasImportWarning = importWarning !== null;
  const providerLabel = labelForProvider(provider);
  const draftSlotsCount = draft?.settings.teams ?? 0;
  const draftSlots = React.useMemo(
    () => Array.from({ length: draftSlotsCount }, (_, index) => index + 1),
    [draftSlotsCount]
  );
  const draftPositionNumber = Number.parseInt(draftPosition, 10);
  const isDraftPositionValid = draftSlots.includes(draftPositionNumber);
  const liveDraftBlockers = readiness.productBlockingFailures;
  const liveDraftBlocked = liveDraftBlockers.length > 0;
  const primaryLiveDraftBlocker = liveDraftBlockers[0];
  const degradedOptionalData = readiness.optionalSignalDegradations;
  const hasReadinessDetails =
    liveDraftBlocked ||
    readiness.actionableWarnings.length > 0 ||
    degradedOptionalData.length > 0;

  const syncConfidence: SyncConfidence = {
    tone: isError
      ? 'bad'
      : connectedDraftId && !isConnecting && isDraftPositionConfirmed
        ? hasImportWarning
          ? 'warn'
          : 'good'
        : 'neutral',
    label: isError
      ? 'Draft sync needs attention'
      : isConnecting
        ? 'Draft sync connecting'
        : connectedDraftId && isDraftPositionConfirmed
          ? hasImportWarning
            ? `${String(rejectedPickCount)} ${
              rejectedPickCount === 1 ? 'pick' : 'picks'
            } not imported`
            : isComplete
              ? 'Draft sync complete'
              : isDrafting
                ? 'Live draft connected'
                : isPaused
                  ? 'Paused draft connected'
                  : 'Draft sync ready'
          : 'Live draft not connected',
  };

  const confidenceItems = (
    <DataConfidenceSummary
      sync={syncConfidence}
      now={now}
      fantasyProsRefreshedAt={fantasyProsRefreshedAt}
      sleeperFetchedAt={sleeperFetchedAt}
      fantasyProsSourceType={fantasyProsSourceType}
      dataFreshness={dataFreshness}
      leagueSettings={leagueSettings}
      predictionModelVersion={predictionModelVersion}
      predictionGeneratedAt={predictionGeneratedAt}
      shadowRecommendationAvailable={shadowRecommendationAvailable}
      recommendationPolicyReason={recommendationPolicyReason}
      degradedOptionalData={degradedOptionalData}
    />
  );

  const liveDraftBlockerPanel = liveDraftBlocked ? (
    <DraftReadinessBlockedNotice readiness={readiness} showLeagueActions={false} />
  ) : null;

  const optionalSignalPanel = (
    <OptionalSignalPanel
      degradedOptionalData={degradedOptionalData}
      expanded={isOptionalSignalsExpanded}
      onExpandedChange={setIsOptionalSignalsExpanded}
    />
  );

  const warningPanel = <ReadinessWarningPanel warnings={readiness.actionableWarnings} />;

  const handleConnect = () => {
    const validation = validateDraftInput(provider, draftIdInput);
    if (!validation.ok) {
      // Say why instead of silently ignoring the attempt, and put the user back in the field.
      setDraftInputError(validation.message);
      draftInputRef.current?.focus();
      return;
    }
    const parsedConnection = validation.connection;
    setDraftInputError(null);
    setProvider(parsedConnection.provider);
    setDraftIdInput(parsedConnection.draftId);
    startConnection(parsedConnection);
    if (parsedConnection.provider === 'sleeper') {
      sendWorkspaceCommand(workspace, 'connection.setPrimaryLeagueSettings', pendingSettingsProfile === 'primary-league-mock');
      sendWorkspaceCommand(workspace, 'connection.setQuickMockSettings', pendingSettingsProfile === 'quick-mock');
    }
  };

  const handleConfirmDraftPosition = () => {
    if (!isDraftPositionValid) {
      return;
    }

    confirmDraftPosition(draftPositionNumber);
  };

  const handleDisconnect = () => {
    disconnect();
    setDraftPosition('1');
    setIsDialogOpen(false);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);

    try {
      await refresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  const dialogContent = !connectedDraftId ? (
    <DraftEntryStep
      provider={provider}
      onProviderChange={(value) => { setProvider(value); setDraftInputError(null); }}
      draftIdInput={draftIdInput}
      onDraftIdChange={(value) => { setDraftIdInput(value); setDraftInputError(null); }}
      inputError={draftInputError}
      inputRef={draftInputRef}
      onConnect={handleConnect}
    />
  ) : isConnecting ? (
    <ConnectingStep provider={provider} onDisconnect={handleDisconnect} />
  ) : isError ? (
    <SyncErrorStep provider={provider} lastError={lastError} onDisconnect={handleDisconnect} />
  ) : !isDraftPositionConfirmed ? (
    <DraftSlotStep
      draftPosition={draftPosition}
      onDraftPositionChange={setDraftPosition}
      draftSlots={draftSlots}
      isValid={isDraftPositionValid}
      onConfirm={handleConfirmDraftPosition}
      onDisconnect={handleDisconnect}
    />
  ) : (
    <ConnectedSyncStep
      provider={provider}
      sync={sync}
      syncViewState={syncViewState}
      synchronizationState={synchronizationState}
      lastSyncAgeMs={lastSyncAgeMs}
      myPickPosition={myPickPosition}
      draftSlots={draftSlots}
      onConfirmDraftPosition={confirmDraftPosition}
      isRefreshing={isRefreshing}
      onRefresh={() => { void handleRefresh(); }}
      onDisconnect={handleDisconnect}
      onDone={() => { setIsDialogOpen(false); }}
    />
  );

  const settingsProfile = connection
    ? connection.settingsProfile === 'quick-mock' ? 'quick-mock' : connection.usePrimaryLeagueSettings ? 'primary-league-mock' : 'provider'
    : pendingSettingsProfile;
  const practiceSettingsControl = (connection?.provider ?? provider) === 'sleeper' ? (
    <PracticeSettingsControl
      settingsProfile={settingsProfile}
      quickMockPreferences={quickMockPreferences}
      onChange={(value) => {
        if (!connection) { setPendingSettingsProfile(value); return; }
        sendWorkspaceCommand(workspace, 'connection.setPrimaryLeagueSettings', value === 'primary-league-mock');
        sendWorkspaceCommand(workspace, 'connection.setQuickMockSettings', value === 'quick-mock');
      }}
    />
  ) : null;

  if (variant === 'status-control') {
    return (
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="draft-nav-connection h-8 min-w-0 max-w-full gap-2 px-2"
            aria-label={`Manage ${providerLabel} draft connection`}
            title={`Manage ${providerLabel} draft connection`}
          >
            <span className="shrink-0 font-semibold">
              {connection?.usePrimaryLeagueSettings || connection?.settingsProfile === 'quick-mock' ? 'Sleeper mock' : providerLabel}
            </span>
            <span className="draft-nav-sync-status"><DraftSyncStatusIndicator sync={syncViewState} compact announce /></span>
            {connection?.usePrimaryLeagueSettings ? <span className="hidden text-xs text-primary xl:inline">Practice settings</span> : null}
            <Settings2 className="size-3.5 shrink-0 text-muted-foreground" />
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="size-5 text-green-600" />
              Live draft sync
            </DialogTitle>
            <DialogDescription>
              Choose quick mock rules for practice, or verify your actual Primary League settings with Sleeper.
            </DialogDescription>
          </DialogHeader>
          {practiceSettingsControl}
          {liveDraftBlockerPanel}
          {dialogContent}
          {warningPanel}
          {optionalSignalPanel}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <div className={cn(!isStrip && 'space-y-3')}>
      {!isStrip && liveDraftBlockerPanel}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
      <DraftConnectSummaryRow
        isStrip={isStrip}
        liveDraftBlocked={liveDraftBlocked}
        blockerCount={liveDraftBlockers.length}
        primaryLiveDraftBlocker={primaryLiveDraftBlocker}
        connectedDraftId={connectedDraftId}
        isError={isError}
        isConnecting={isConnecting}
        hasImportWarning={hasImportWarning}
        isDraftPositionConfirmed={isDraftPositionConfirmed}
        providerLabel={providerLabel}
        provider={provider}
        rejectedPickCount={rejectedPickCount}
        isComplete={isComplete}
        isDrafting={isDrafting}
        isPaused={isPaused}
        synchronizationState={synchronizationState}
        totalPicks={totalPicks}
        myPicksCount={myPicksCount}
        myPickPosition={myPickPosition}
        draftSlotsCount={draftSlotsCount}
        lastError={lastError}
        importWarning={importWarning}
        confidenceItems={confidenceItems}
        hasReadinessDetails={hasReadinessDetails}
        onViewDetails={() => {
          setIsOptionalSignalsExpanded(false);
          setIsReadinessDrawerOpen(true);
        }}
      />

      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="size-5 text-green-600" />
            Live draft sync
          </DialogTitle>
          <DialogDescription>
            Connect once to keep players, recommendations, and your roster aligned
            with the live draft room.
          </DialogDescription>
        </DialogHeader>
        {practiceSettingsControl}
        {dialogContent}
      </DialogContent>
      </Dialog>

      {isStrip && hasReadinessDetails ? (
        <Dialog
          open={isReadinessDrawerOpen}
          onOpenChange={(open) => {
            setIsReadinessDrawerOpen(open);
            if (!open) setIsOptionalSignalsExpanded(false);
          }}
        >
          <DialogContent
            scrollable={false}
            className="dialog-sheet-right inset-y-0 right-0 left-auto grid h-dvh w-[min(440px,100vw)] max-w-none translate-x-0 translate-y-0 grid-rows-[auto_minmax(0,1fr)] gap-0 rounded-none border-y-0 border-r-0 p-0 sm:max-w-none"
          >
            <DialogHeader className="border-b border-border/70 px-5 py-4 pr-12">
              <DialogTitle>Draft readiness details</DialogTitle>
              <DialogDescription>
                Core Draft Data failures block live Recommendations. Optional Signal warnings do not.
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 space-y-3 overflow-y-auto p-4">
              {liveDraftBlockerPanel}
              {warningPanel}
              {optionalSignalPanel}
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
