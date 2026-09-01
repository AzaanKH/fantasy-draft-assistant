/**
 * Draft Connection Component
 *
 * Guides the user through connecting a provider draft and keeps the live sync
 * state visible while they use the draft board.
 */

import * as React from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Link2,
  LoaderCircle,
  RefreshCw,
  Settings2,
  Unplug,
} from 'lucide-react';
import { MotionExpandable } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import {
  formatDraftReadinessTimestamp,
  type DraftProvider,
  type DraftReadinessReport,
} from '@fantasy-draft/shared';
import { formatDraftSyncAge } from '@/hooks/useDraftSync';
import { useDraftStore } from '@/stores/draftStore';
import { cn } from '@/lib/utils';
import type { DataFreshnessItem } from '@/lib/data-freshness';
import { DraftSyncStatusIndicator } from '@/features/draft-room/DraftSyncStatusIndicator';
import {
  useLiveDraftSyncActions,
  useLiveDraftSyncState,
} from '@/features/draft-room/LiveDraftSyncProvider';

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
}

type ConfidenceTone = 'neutral' | 'good' | 'warn' | 'bad';

interface InitialConnection {
  readonly provider: DraftProvider;
  readonly draftId: string;
}

function parseDraftId(
  selectedProvider: DraftProvider,
  input: string
): InitialConnection | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const yahooMatch = trimmed.match(
    /\/(?:draftclient\/f1|draft\/f1|f1)\/(\d+)(?:\/|$)/
  );
  if (yahooMatch?.[1]) {
    return { provider: 'yahoo', draftId: yahooMatch[1] };
  }

  const sleeperMatch = trimmed.match(/draft\/nfl\/(\d+)/);
  if (sleeperMatch?.[1]) {
    return { provider: 'sleeper', draftId: sleeperMatch[1] };
  }

  try {
    const url = new URL(trimmed);
    const leagueId = url.searchParams.get('leagueId');
    if (
      url.hostname === 'fantasy.espn.com' &&
      url.pathname === '/football/draft' &&
      leagueId &&
      /^\d{1,20}$/.test(leagueId)
    ) {
      return { provider: 'espn', draftId: leagueId };
    }
  } catch {
    // A provider draft ID is also valid input.
  }

  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) return null;
  return { provider: selectedProvider, draftId: trimmed };
}

function formatRelativeAge(timestamp: string, now: number): string | null {
  const refreshedAt = Date.parse(timestamp);
  if (Number.isNaN(refreshedAt)) {
    return null;
  }

  const elapsedMinutes = Math.max(0, Math.floor((now - refreshedAt) / 60_000));
  if (elapsedMinutes < 1) return 'just now';
  if (elapsedMinutes < 60) return `${String(elapsedMinutes)}m ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${String(elapsedHours)}h ago`;

  return `${String(Math.floor(elapsedHours / 24))}d ago`;
}

function formatTimestamp(timestamp: string | undefined): string {
  if (!timestamp) return 'unavailable';

  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? timestamp : new Date(parsed).toLocaleString();
}

function getOldestTimestamp(timestamps: readonly (string | undefined)[]): string | null {
  const validTimestamps = timestamps.filter(
    (timestamp): timestamp is string =>
      timestamp !== undefined && !Number.isNaN(Date.parse(timestamp))
  );

  if (validTimestamps.length === 0) return null;

  return validTimestamps.reduce((oldest, timestamp) =>
    Date.parse(timestamp) < Date.parse(oldest) ? timestamp : oldest
  );
}

function DataConfidenceItem({
  children,
  title,
  tone,
}: {
  children: React.ReactNode;
  title?: string;
  tone: ConfidenceTone;
}) {
  const dotClass = {
    neutral: 'bg-muted-foreground/60',
    good: 'bg-green-600',
    warn: 'bg-amber-500',
    bad: 'bg-destructive',
  }[tone];

  return (
    <span className="inline-flex items-center gap-1.5" title={title}>
      <span className={cn('size-1.5 rounded-full', dotClass)} />
      <span>{children}</span>
    </span>
  );
}

function SyncDetail({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div className="rounded-md border bg-background/60 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold tabular-nums">{children}</div>
    </div>
  );
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
}: DraftConnectProps): React.ReactElement {
  const {
    connection,
    sync,
    synchronizationState,
    viewState: syncViewState,
  } = useLiveDraftSyncState();
  const {
    startConnection,
    confirmDraftPosition,
    disconnect,
  } = useLiveDraftSyncActions();
  const [isDialogOpen, setIsDialogOpen] = React.useState(false);
  const [provider, setProvider] = React.useState<DraftProvider>(
    connection?.provider ?? 'sleeper'
  );
  const [draftIdInput, setDraftIdInput] = React.useState(
    connection?.draftId ?? ''
  );
  const [draftPosition, setDraftPosition] = React.useState(
    connection?.draftPosition === null || connection === null
      ? '1'
      : String(connection.draftPosition)
  );
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [isReadinessDrawerOpen, setIsReadinessDrawerOpen] = React.useState(false);
  const [isOptionalSignalsExpanded, setIsOptionalSignalsExpanded] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());
  const isStrip = variant === 'strip';

  React.useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 60_000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  const myPickPosition = useDraftStore((state) => state.config.myPickPosition);
  const leagueSettings = useDraftStore((state) => state.leagueSettings);
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
    lastSyncAgeMs,
    isDrafting,
    isPaused,
    isComplete,
    importWarning,
    rejectedPickCount,
    refresh,
  } = sync;
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
  const isSyncDegraded =
    connectionState === 'reconnecting' ||
    connectionState === 'stale' ||
    synchronizationState === 'manual-continuity';
  const providerLabel =
    provider === 'yahoo' ? 'Yahoo' : provider === 'espn' ? 'ESPN' : 'Sleeper';
  const draftSlotsCount = draft?.settings.teams ?? 0;
  const draftSlots = React.useMemo(
    () => Array.from({ length: draftSlotsCount }, (_, index) => index + 1),
    [draftSlotsCount]
  );
  const draftPositionNumber = Number.parseInt(draftPosition, 10);
  const isDraftPositionValid = draftSlots.includes(draftPositionNumber);
  const ffcAdpFreshness = dataFreshness.find((item) => item.key === 'ffc-adp');
  const marketRefreshedAt = getOldestTimestamp([
    fantasyProsRefreshedAt,
    ffcAdpFreshness?.timestamp ?? sleeperFetchedAt,
  ]);
  const marketAge = marketRefreshedAt
    ? formatRelativeAge(marketRefreshedAt, now)
    : null;
  const marketAgeHours = marketRefreshedAt
    ? Math.max(0, (now - Date.parse(marketRefreshedAt)) / 3_600_000)
    : null;
  const marketTone: ConfidenceTone =
    marketAgeHours === null
      ? 'bad'
      : marketAgeHours >= 72
        ? 'bad'
        : marketAgeHours >= 24
          ? 'warn'
          : 'good';
  const marketTitle = [
    `FantasyPros snapshot: ${formatTimestamp(fantasyProsRefreshedAt)}${fantasyProsSourceType ? ` (${fantasyProsSourceType})` : ''}`,
    ffcAdpFreshness?.timestamp
      ? `Fantasy Football Calculator ADP: ${formatTimestamp(ffcAdpFreshness.timestamp)}`
      : `FFC ADP unavailable; FantasyPros/Sleeper fallback: ${formatTimestamp(sleeperFetchedAt)}`,
  ].join('\n');
  const settingsWarnings =
    leagueSettings.unsupportedScoringKeys.length +
    leagueSettings.unsupportedRosterSlots.length;
  const scoringLabel = [
    `${String(leagueSettings.scoringRules.passing.touchdown)}/pass TD`,
    `${String(leagueSettings.scoringRules.receiving.reception)} PPR`,
    leagueSettings.scoringRules.receiving.tePremium > 0
      ? `TE +${String(leagueSettings.scoringRules.receiving.tePremium)}/rec`
      : null,
    leagueSettings.scoringRules.rushing.attemptBonus > 0
      ? `rush +${String(leagueSettings.scoringRules.rushing.attemptBonus)}/att`
      : null,
  ].filter((value): value is string => value !== null).join(' · ');
  const leagueSettingsTitle = [
    `Scoring: ${scoringLabel}`,
    `Teams: ${String(leagueSettings.totalTeams)}`,
    `Keepers: ${leagueSettings.keepersEnabled === null ? 'provider did not report' : leagueSettings.keepersEnabled ? 'enabled' : 'disabled'}`,
    `Settings fingerprint: ${leagueSettings.fingerprint}`,
    ...(leagueSettings.unsupportedScoringKeys.length > 0
      ? [`Unsupported scoring keys: ${leagueSettings.unsupportedScoringKeys.join(', ')}`]
      : []),
    ...(leagueSettings.unsupportedRosterSlots.length > 0
      ? [`Unsupported roster slots: ${leagueSettings.unsupportedRosterSlots.join(', ')}`]
      : []),
  ].join('\n');
  const hasPredictionModel =
    predictionModelVersion !== undefined && predictionModelVersion !== 'none';
  const liveDraftBlockers = readiness.productBlockingFailures;
  const liveDraftBlocked = liveDraftBlockers.length > 0;
  const primaryLiveDraftBlocker = liveDraftBlockers[0];
  const degradedOptionalData = readiness.optionalSignalDegradations;
  const hasReadinessDetails =
    liveDraftBlocked ||
    readiness.actionableWarnings.length > 0 ||
    degradedOptionalData.length > 0;
  const predictionDegradation = degradedOptionalData.find(
    (item) => item.key === 'experimental-predictions'
  );
  const contractDegradation = degradedOptionalData.find(
    (item) => item.key === 'contract-context'
  );
  const sportsbookDegradation = degradedOptionalData.find(
    (item) => item.key === 'sportsbook-context'
  );

  const confidenceItems = (
    <>
      <DataConfidenceItem
        tone={
          isError
            ? 'bad'
            : connectedDraftId && !isConnecting && isDraftPositionConfirmed
              ? hasImportWarning
                ? 'warn'
                : 'good'
              : 'neutral'
        }
      >
        {isError
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
              : 'Live draft not connected'}
      </DataConfidenceItem>
      <DataConfidenceItem tone={marketTone} title={marketTitle}>
        {marketAge
          ? `Market data refreshed ${marketAge}`
          : 'Market data unavailable'}
      </DataConfidenceItem>
      <DataConfidenceItem
        tone={settingsWarnings > 0
          ? 'warn'
          : leagueSettings.source === 'sleeper' || leagueSettings.source === 'espn'
            ? 'good'
            : 'neutral'}
        title={leagueSettingsTitle}
      >
        {leagueSettings.source === 'sleeper' || leagueSettings.source === 'espn'
          ? settingsWarnings > 0
            ? `${leagueSettings.source === 'espn' ? 'ESPN' : 'Sleeper'} settings applied · ${String(settingsWarnings)} warning${settingsWarnings === 1 ? '' : 's'}`
            : `${leagueSettings.source === 'espn' ? 'ESPN' : 'Sleeper'} settings applied · ${scoringLabel}`
          : `Default settings · ${scoringLabel}`}
      </DataConfidenceItem>
      <DataConfidenceItem
        tone={predictionDegradation ? 'warn' : shadowRecommendationAvailable ? 'good' : 'neutral'}
        title={predictionDegradation?.message ??
          (shadowRecommendationAvailable && hasPredictionModel
            ? `Experimental prediction artifact · model ${predictionModelVersion} · generated ${formatTimestamp(predictionGeneratedAt ?? undefined)} · used only for Shadow Recommendation`
            : recommendationPolicyReason)}
      >
        {predictionDegradation
          ? 'Shadow Recommendation unavailable'
          : shadowRecommendationAvailable && hasPredictionModel
            ? 'Shadow Recommendation ready · live order isolated'
            : 'Shadow Recommendation unavailable'}
      </DataConfidenceItem>
      {contractDegradation && (
        <DataConfidenceItem tone="warn" title={contractDegradation.message}>
          Contract context unavailable
        </DataConfidenceItem>
      )}
      {sportsbookDegradation && (
        <DataConfidenceItem
          tone="warn"
          title={sportsbookDegradation.message}
        >
          Sportsbook context unavailable
        </DataConfidenceItem>
      )}
      {degradedOptionalData.length > 1 && (
        <DataConfidenceItem tone="warn">
          {degradedOptionalData.length} optional feeds degraded
        </DataConfidenceItem>
      )}
    </>
  );

  const liveDraftBlockerPanel = liveDraftBlocked ? (
    <section
      aria-labelledby="draft-readiness-heading"
      className="rounded-lg border border-red-500/45 bg-red-500/[0.08] p-4"
      role="alert"
    >
      <h3
        id="draft-readiness-heading"
        className="flex items-center gap-2 text-sm font-semibold text-red-800 dark:text-red-300"
      >
        <CircleAlert className="size-4" />
        Core Draft Data blocks live Recommendations
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Resolve each product-blocking failure below. Optional Signals never take the Draft Workspace offline.
      </p>
      <ul className="mt-3 space-y-2 text-xs">
        {liveDraftBlockers.map((item) => (
          <li
            key={item.key}
            className="rounded-md border border-red-500/20 bg-background/70 px-3 py-2"
          >
            <div className="font-medium">{item.label}</div>
            <div className="mt-0.5 text-muted-foreground">
              {item.sourceLabel} · {item.timestampLabel}{' '}
              <span className="font-mono tabular-nums">
                {formatDraftReadinessTimestamp(item.timestamp)}
              </span>
            </div>
            <p className="mt-1 leading-relaxed text-muted-foreground">{item.message}</p>
            <div className="mt-1 font-medium text-red-800 dark:text-red-300">
              Action: {item.correctiveAction}
            </div>
          </li>
        ))}
      </ul>
    </section>
  ) : null;

  const optionalSignalPanel = degradedOptionalData.length > 0 ? (
    <section
      className="overflow-hidden rounded-lg border border-amber-500/35 bg-amber-500/[0.07]"
      aria-labelledby="optional-signal-heading"
    >
      <Button
        variant="ghost"
        className="h-auto w-full justify-between rounded-none px-3 py-3 text-left hover:bg-amber-500/[0.08]"
        aria-controls="optional-signal-details"
        aria-expanded={isOptionalSignalsExpanded}
        onClick={() => { setIsOptionalSignalsExpanded((current) => !current); }}
      >
        <span>
          <span
            id="optional-signal-heading"
            className="block text-xs font-semibold text-amber-800 dark:text-amber-300"
          >
            Optional Signals
          </span>
          <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
            {String(degradedOptionalData.length)} degraded · Recommendations remain available
          </span>
        </span>
        {isOptionalSignalsExpanded ? (
          <ChevronUp className="size-4" />
        ) : (
          <ChevronDown className="size-4" />
        )}
      </Button>
      <MotionExpandable open={isOptionalSignalsExpanded}>
        <ul id="optional-signal-details" className="space-y-2 border-t border-amber-500/20 p-3 text-[11px]">
          {degradedOptionalData.map((item) => (
            <li key={item.key} className="rounded-md border border-amber-500/20 bg-background/70 px-3 py-2">
              <div className="font-medium">{item.label}</div>
              <div className="mt-0.5 text-muted-foreground">
                {item.sourceLabel} · {item.timestampLabel}{' '}
                <span className="font-mono tabular-nums">
                  {formatDraftReadinessTimestamp(item.timestamp)}
                </span>
              </div>
              <p className="mt-1 text-muted-foreground">{item.message}</p>
              <div className="mt-1 font-medium text-amber-800 dark:text-amber-300">
                Optional action: {item.correctiveAction}
              </div>
            </li>
          ))}
        </ul>
      </MotionExpandable>
    </section>
  ) : null;

  const warningPanel = readiness.actionableWarnings.length > 0 ? (
    <section
      className="rounded-lg border border-amber-500/30 bg-amber-500/[0.04] px-3 py-3"
      aria-labelledby="readiness-warning-heading"
    >
      <h3 id="readiness-warning-heading" className="text-xs font-semibold text-amber-800 dark:text-amber-300">
        Actionable warnings
      </h3>
      <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">
        {readiness.actionableWarnings.map((warning) => (
          <li key={warning.key}>
            <span className="font-medium text-foreground">{warning.label}:</span>{' '}
            {warning.message}{warning.correctiveAction ? ` ${warning.correctiveAction}` : ''}
          </li>
        ))}
      </ul>
    </section>
  ) : null;

  const handleConnect = () => {
    const parsedConnection = parseDraftId(provider, draftIdInput);
    if (!parsedConnection) return;

    setProvider(parsedConnection.provider);
    setDraftIdInput(parsedConnection.draftId);
    startConnection(parsedConnection);
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
    <div className="space-y-5">
      <div className="space-y-2">
        <label htmlFor="draft-provider" className="text-sm font-medium">
          Draft provider
        </label>
        <Select
          id="draft-provider"
          value={provider}
          onValueChange={(value) => {
            if (value === 'sleeper' || value === 'yahoo' || value === 'espn') {
              setProvider(value);
            }
          }}
          options={[
            { value: 'sleeper', label: 'Sleeper' },
            { value: 'espn', label: 'ESPN' },
            { value: 'yahoo', label: 'Yahoo' },
          ]}
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="provider-draft-id" className="text-sm font-medium">
          {providerLabel} draft URL or ID
        </label>
        <Input
          id="provider-draft-id"
          autoFocus
          placeholder={
            provider === 'yahoo'
              ? 'https://football.fantasysports.yahoo.com/f1/...'
              : provider === 'espn'
                ? 'https://fantasy.espn.com/football/draft?leagueId=...'
                : 'https://sleeper.com/draft/nfl/...'
          }
          value={draftIdInput}
          onChange={(event) => {
            setDraftIdInput(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              handleConnect();
            }
          }}
        />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Open your {providerLabel} draft room and paste its URL, or enter the
          provider ID from that URL directly.
        </p>
      </div>

      <div className="rounded-md border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
        {provider === 'espn'
          ? 'ESPN picks come from the Chrome extension. Log into ESPN normally and keep the live draft tab open; the app never receives your ESPN credentials.'
          : 'Picks import automatically every second from the provider\'s read-only server endpoint. Login is not required.'}
      </div>

      <DialogFooter>
        <Button
          onClick={handleConnect}
          disabled={!draftIdInput.trim()}
        >
          Continue
        </Button>
      </DialogFooter>
    </div>
  ) : isConnecting ? (
    <div className="space-y-5">
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <LoaderCircle className="size-8 animate-spin text-green-600" />
        <div>
          <div className="font-semibold">Connecting to {providerLabel}...</div>
          <p className="mt-1 text-sm text-muted-foreground">
            Fetching the draft room and importing picks.
          </p>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={handleDisconnect}>
          <Unplug />
          Disconnect
        </Button>
      </DialogFooter>
    </div>
  ) : isError ? (
    <div className="space-y-4">
      <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4">
        <div className="flex items-center gap-2 font-semibold text-destructive">
          <CircleAlert className="size-4" />
          {providerLabel} draft could not be synced
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {lastError ?? 'Check the draft URL or ID and try again.'}
        </p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={handleDisconnect}>
          Edit draft details
        </Button>
      </DialogFooter>
    </div>
  ) : !isDraftPositionConfirmed ? (
    <div className="space-y-5">
      <div className="space-y-2">
        <label className="text-sm font-medium">Your draft slot</label>
        <div className="flex items-center gap-3">
          <Select
            aria-label="Your draft slot"
            className="w-28"
            value={draftPosition}
            onValueChange={setDraftPosition}
            options={draftSlots.map((position) => ({
              value: position.toString(),
              label: `Slot ${String(position)}`,
            }))}
          />
          <span className="text-xs text-muted-foreground">
            Used to identify your picks and build your roster.
          </span>
        </div>
      </div>

      <DialogFooter className="sm:justify-between">
        <Button variant="outline" onClick={handleDisconnect}>
          <Unplug />
          Disconnect
        </Button>
        <Button
          onClick={handleConfirmDraftPosition}
          disabled={!isDraftPositionValid}
        >
          Start syncing
        </Button>
      </DialogFooter>
    </div>
  ) : (
    <div className="space-y-4">
      <div className={cn(
        'rounded-md border p-4',
        isSyncDegraded
          ? 'border-amber-500/45 bg-amber-500/10'
          : 'border-green-500/40 bg-green-500/10'
      )}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold">
          <span>{providerLabel} draft</span>
          <DraftSyncStatusIndicator sync={syncViewState} />
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {synchronizationState === 'manual-continuity'
            ? 'Manual Continuity is active. Provider Truth remains loaded, and Provisional Picks stay local until reconciliation is available.'
            : connectionState === 'reconnecting'
            ? 'The live stream dropped. Reconnecting automatically while the last synced picks remain visible.'
            : connectionState === 'stale'
              ? `The last successful snapshot was ${formatDraftSyncAge(lastSyncAgeMs)}. Verify the provider or extension before relying on the board.`
              : connectionState === 'syncing'
                ? 'Waiting for the first successful provider snapshot.'
                : connectionState === 'complete'
                  ? 'The final provider snapshot has been imported.'
                  : 'Picks are being imported automatically while this page is open.'}
        </p>
      </div>

      {importWarning && (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-4">
          <div className="flex items-center gap-2 font-semibold text-amber-700 dark:text-amber-400">
            <CircleAlert className="size-4" />
            {rejectedPickCount}{' '}
            {rejectedPickCount === 1 ? 'pick needs' : 'picks need'} attention
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {importWarning}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SyncDetail label="Format">
          {draft?.settings.teams} teams
        </SyncDetail>
        <SyncDetail label="Rounds">{draft?.settings.rounds}</SyncDetail>
        <SyncDetail label="Your slot">{myPickPosition}</SyncDetail>
        <SyncDetail label="Picks synced">{totalPicks}</SyncDetail>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">
          {isComplete
            ? 'Complete'
            : isDrafting
              ? 'Live draft'
              : isPaused
                ? 'Paused'
                : 'Pre-draft'}
        </Badge>
        <span>{myPicksCount} of your picks imported</span>
        {rejectedPickCount > 0 && (
          <>
            <span>·</span>
            <span className="text-amber-700 dark:text-amber-400">
              {rejectedPickCount} not imported
            </span>
          </>
        )}
        <span>·</span>
        <span>
          {provider === 'espn' ? 'Live extension feed' : 'Synced every second'}
        </span>
      </div>

      <DialogFooter className="sm:justify-between">
        <Button variant="outline" onClick={handleDisconnect}>
          <Unplug />
          Disconnect
        </Button>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              void handleRefresh();
            }}
            disabled={isRefreshing}
          >
            <RefreshCw className={cn(isRefreshing && 'animate-spin')} />
            Refresh now
          </Button>
          <Button
            onClick={() => {
              setIsDialogOpen(false);
            }}
          >
            Done
          </Button>
        </div>
      </DialogFooter>
    </div>
  );

  if (variant === 'status-control') {
    return (
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 min-w-0 max-w-full gap-2 px-2"
            aria-label={`Manage ${providerLabel} draft connection`}
            title={`Manage ${providerLabel} draft connection`}
          >
            <span className="hidden shrink-0 font-semibold sm:inline">
              {providerLabel}
            </span>
            <DraftSyncStatusIndicator sync={syncViewState} compact announce />
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
              Review this provider connection, refresh its draft state, or
              disconnect before switching to another draft room.
            </DialogDescription>
          </DialogHeader>
          {dialogContent}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <div className={cn(!isStrip && 'space-y-3')}>
      {!isStrip && liveDraftBlockerPanel}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
      <div
        className={cn(
          'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between',
          isStrip ? 'min-h-14 px-3 py-2' : 'rounded-lg border p-4',
          isStrip && liveDraftBlocked
            ? 'bg-red-500/[0.04]'
            : connectedDraftId
              ? isError
                ? isStrip
                  ? 'bg-destructive/[0.04]'
                  : 'border-destructive/40 bg-destructive/[0.06]'
                : hasImportWarning
                  ? isStrip
                    ? 'bg-amber-500/[0.04]'
                    : 'border-amber-500/40 bg-amber-500/[0.07]'
                  : isStrip
                    ? 'bg-green-500/[0.035]'
                    : 'border-green-500/35 bg-green-500/[0.07]'
              : isStrip
                ? 'bg-muted/10'
                : 'border-dashed bg-muted/20'
        )}
      >
        <div className="flex min-w-0 items-start gap-3">
          <div
            className={cn(
              'flex shrink-0 items-center justify-center rounded-full border',
              isStrip ? 'size-8' : 'size-9',
              isStrip && liveDraftBlocked
                ? 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300'
                : connectedDraftId && !isError
                  ? hasImportWarning
                    ? 'border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                    : 'border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400'
                  : isError
                    ? 'border-destructive/50 bg-destructive/10 text-destructive'
                    : 'bg-background text-muted-foreground'
            )}
          >
            {isStrip && liveDraftBlocked ? (
              <CircleAlert className="size-4" />
            ) : isConnecting ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : connectedDraftId && !isError ? (
              hasImportWarning ? (
                <CircleAlert className="size-4" />
              ) : (
                <CheckCircle2 className="size-4" />
              )
            ) : isError ? (
              <CircleAlert className="size-4" />
            ) : (
              <Link2 className="size-4" />
            )}
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">
                {isStrip && primaryLiveDraftBlocker
                  ? primaryLiveDraftBlocker.label
                  : !connectedDraftId
                    ? 'Connect your live draft'
                    : isError
                      ? `${providerLabel} sync needs attention`
                      : isConnecting
                        ? `Connecting to ${providerLabel}...`
                        : !isDraftPositionConfirmed
                          ? 'Choose your draft slot'
                          : hasImportWarning
                            ? `${String(rejectedPickCount)} ${
                              rejectedPickCount === 1 ? 'pick was' : 'picks were'
                            } not imported`
                            : `${providerLabel} draft connected`}
              </span>
              {isStrip && liveDraftBlockers.length > 1 ? (
                <span className="text-[11px] font-medium text-red-700 dark:text-red-300">
                  +{String(liveDraftBlockers.length - 1)} more
                </span>
              ) : null}
              {connectedDraftId && !isError && !isConnecting && (
                <Badge
                  variant="outline"
                  className={cn(
                    hasImportWarning
                      ? 'border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                      : 'border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400'
                  )}
                >
                  {hasImportWarning
                    ? 'Attention'
                    : isComplete
                      ? 'Complete'
                      : isDrafting
                        ? 'Live'
                        : isPaused
                          ? 'Paused'
                          : 'Ready'}
                </Badge>
              )}
            </div>
            <p className={cn(
              'mt-1 text-xs leading-relaxed text-muted-foreground',
              isStrip && 'truncate'
            )}>
              {isStrip && primaryLiveDraftBlocker
                ? `Action: ${primaryLiveDraftBlocker.correctiveAction}`
                : synchronizationState === 'manual-continuity'
                  ? `${String(totalPicks)} provider picks retained · Manual Continuity is recording Provisional Picks locally`
                : !connectedDraftId
                  ? 'Import picks automatically, track your roster, and keep recommendations current during the draft.'
                  : isError
                    ? lastError ?? 'Open sync settings to check the draft URL or ID.'
                    : isConnecting
                      ? 'Fetching the draft room and importing picks.'
                      : !isDraftPositionConfirmed
                        ? `${String(draftSlotsCount)}-team draft found · choose your slot to start importing picks.`
                        : importWarning
                          ? importWarning
                          : `${String(totalPicks)} picks synced · ${String(myPicksCount)} yours · slot ${String(myPickPosition)} · ${provider === 'espn' ? 'live extension feed' : 'updates every second'}`}
            </p>
            {!isStrip && (
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                {confidenceItems}
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {isStrip && hasReadinessDetails ? (
            <Button
              variant="ghost"
              size="sm"
              aria-haspopup="dialog"
              onClick={() => {
                setIsOptionalSignalsExpanded(false);
                setIsReadinessDrawerOpen(true);
              }}
            >
              View details
            </Button>
          ) : null}
          <DialogTrigger asChild>
            <Button
              variant={connectedDraftId && !isError ? 'outline' : 'default'}
              size="sm"
              className="shrink-0"
            >
              {!connectedDraftId
                ? liveDraftBlocked
                  ? 'Connect to verify'
                  : 'Connect draft'
                : isError
                  ? 'Fix connection'
                  : isConnecting
                    ? 'View progress'
                    : !isDraftPositionConfirmed
                      ? 'Choose slot'
                      : 'Manage sync'}
            </Button>
          </DialogTrigger>
        </div>
      </div>

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
            className="inset-y-0 right-0 left-auto grid h-dvh w-[min(440px,100vw)] max-w-none translate-x-0 translate-y-0 grid-rows-[auto_minmax(0,1fr)] gap-0 rounded-none border-y-0 border-r-0 p-0 data-[state=closed]:slide-out-to-right data-[state=closed]:zoom-out-100 data-[state=open]:slide-in-from-right data-[state=open]:zoom-in-100 sm:max-w-none"
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
