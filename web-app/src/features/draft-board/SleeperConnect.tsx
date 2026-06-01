/**
 * Sleeper Draft Connection Component
 *
 * Guides the user through connecting a Sleeper draft and keeps the live sync
 * state visible while they use the draft board.
 */

import * as React from 'react';
import {
  CheckCircle2,
  CircleAlert,
  Link2,
  LoaderCircle,
  RefreshCw,
  Unplug,
} from 'lucide-react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSleeperDraft } from '@/hooks/useSleeperDraft';
import { useDraftStore } from '@/stores/draftStore';
import { cn } from '@/lib/utils';

interface SleeperConnectProps {
  fantasyProsRefreshedAt?: string;
  sleeperFetchedAt?: string;
  fantasyProsSourceType?: string;
  predictionModelVersion?: string;
  predictionsError?: Error | null;
  contractsError?: Error | null;
}

type ConfidenceTone = 'neutral' | 'good' | 'warn' | 'bad';

function formatRelativeAge(timestamp: string, now: number): string | null {
  const refreshedAt = Date.parse(timestamp);
  if (Number.isNaN(refreshedAt)) {
    return null;
  }

  const elapsedMinutes = Math.max(0, Math.floor((now - refreshedAt) / 60_000));
  if (elapsedMinutes < 1) return 'just now';
  if (elapsedMinutes < 60) return `${String(elapsedMinutes)}m ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 48) return `${String(elapsedHours)}h ago`;

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

export function SleeperConnect({
  fantasyProsRefreshedAt,
  sleeperFetchedAt,
  fantasyProsSourceType,
  predictionModelVersion,
  predictionsError,
  contractsError,
}: SleeperConnectProps): React.ReactElement {
  const [isDialogOpen, setIsDialogOpen] = React.useState(false);
  const [draftIdInput, setDraftIdInput] = React.useState('');
  const [draftPosition, setDraftPosition] = React.useState('1');
  const [connectedDraftId, setConnectedDraftId] = React.useState<string | null>(null);
  const [isDraftPositionConfirmed, setIsDraftPositionConfirmed] = React.useState(false);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 60_000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  const setConfig = useDraftStore((state) => state.setConfig);
  const myPickPosition = useDraftStore((state) => state.config.myPickPosition);

  const {
    draft,
    totalPicks,
    myPicksCount,
    isError,
    lastError,
    isDrafting,
    isComplete,
    refresh,
  } = useSleeperDraft(connectedDraftId, isDraftPositionConfirmed);

  const isConnecting =
    connectedDraftId !== null && !draft && !isError;
  const draftSlotsCount = draft?.settings.teams ?? 0;
  const draftSlots = React.useMemo(
    () => Array.from({ length: draftSlotsCount }, (_, index) => index + 1),
    [draftSlotsCount]
  );
  const draftPositionNumber = Number.parseInt(draftPosition, 10);
  const isDraftPositionValid = draftSlots.includes(draftPositionNumber);
  const marketRefreshedAt = getOldestTimestamp([
    fantasyProsRefreshedAt,
    sleeperFetchedAt,
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
    `Sleeper market snapshot: ${formatTimestamp(sleeperFetchedAt)}`,
  ].join('\n');
  const hasPredictionModel =
    predictionModelVersion !== undefined && predictionModelVersion !== 'none';

  const handleConnect = () => {
    // Extract draft ID from a full Sleeper URL if one was pasted.
    const match = draftIdInput.match(/draft\/nfl\/(\d+)/);
    const id = match?.[1] ?? draftIdInput.trim();
    if (!id) {
      return;
    }

    setConnectedDraftId(id);
  };

  const handleConfirmDraftPosition = () => {
    if (!isDraftPositionValid) {
      return;
    }

    setConfig({ myPickPosition: draftPositionNumber });
    setIsDraftPositionConfirmed(true);
  };

  const handleDisconnect = () => {
    setConnectedDraftId(null);
    setDraftPosition('1');
    setIsDraftPositionConfirmed(false);
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
        <label htmlFor="sleeper-draft-id" className="text-sm font-medium">
          Sleeper draft URL or ID
        </label>
        <Input
          id="sleeper-draft-id"
          autoFocus
          placeholder="https://sleeper.com/draft/nfl/..."
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
          Open your Sleeper draft room and paste its URL. You can also paste the
          numeric ID after <span className="font-mono">/draft/nfl/</span>.
        </p>
      </div>

      <div className="rounded-md border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
        Picks import automatically every second during the draft. Sleeper login
        is not required.
      </div>

      <DialogFooter>
        <Button onClick={handleConnect} disabled={!draftIdInput.trim()}>
          Continue
        </Button>
      </DialogFooter>
    </div>
  ) : isConnecting ? (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <LoaderCircle className="size-8 animate-spin text-green-600" />
      <div>
        <div className="font-semibold">Connecting to Sleeper...</div>
        <p className="mt-1 text-sm text-muted-foreground">
          Fetching the draft room and importing picks.
        </p>
      </div>
    </div>
  ) : isError ? (
    <div className="space-y-4">
      <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4">
        <div className="flex items-center gap-2 font-semibold text-destructive">
          <CircleAlert className="size-4" />
          Sleeper draft could not be synced
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
          <Select value={draftPosition} onValueChange={setDraftPosition}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {draftSlots.map((position) => (
                <SelectItem key={position} value={position.toString()}>
                  Slot {position}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            Used to identify your picks and build your roster.
          </span>
        </div>
      </div>

      <DialogFooter>
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
      <div className="rounded-md border border-green-500/40 bg-green-500/10 p-4">
        <div className="flex items-center gap-2 font-semibold text-green-700 dark:text-green-400">
          <CheckCircle2 className="size-4" />
          Sleeper draft connected
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Picks are being imported automatically while this page is open.
        </p>
      </div>

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
          {isComplete ? 'Complete' : isDrafting ? 'Live draft' : 'Pre-draft'}
        </Badge>
        <span>{myPicksCount} of your picks imported</span>
        <span>·</span>
        <span>Synced every second</span>
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

  return (
    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
      <div
        className={cn(
          'flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between',
          connectedDraftId
            ? isError
              ? 'border-destructive/40 bg-destructive/[0.06]'
              : 'border-green-500/35 bg-green-500/[0.07]'
            : 'border-dashed bg-muted/20'
        )}
      >
        <div className="flex min-w-0 items-start gap-3">
          <div
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-full border',
              connectedDraftId && !isError
                ? 'border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400'
                : isError
                  ? 'border-destructive/50 bg-destructive/10 text-destructive'
                  : 'bg-background text-muted-foreground'
            )}
          >
            {isConnecting ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : connectedDraftId && !isError ? (
              <CheckCircle2 className="size-4" />
            ) : isError ? (
              <CircleAlert className="size-4" />
            ) : (
              <Link2 className="size-4" />
            )}
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">
                {!connectedDraftId
                  ? 'Connect your Sleeper draft'
                  : isError
                    ? 'Sleeper sync needs attention'
                    : isConnecting
                      ? 'Connecting to Sleeper...'
                      : !isDraftPositionConfirmed
                        ? 'Choose your draft slot'
                        : 'Sleeper draft connected'}
              </span>
              {connectedDraftId && !isError && !isConnecting && (
                <Badge
                  variant="outline"
                  className="border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400"
                >
                  {isComplete ? 'Complete' : isDrafting ? 'Live' : 'Ready'}
                </Badge>
              )}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {!connectedDraftId
                ? 'Import picks automatically, track your roster, and keep recommendations current during the draft.'
                : isError
                  ? lastError ?? 'Open sync settings to check the draft URL or ID.'
                  : isConnecting
                    ? 'Fetching the draft room and importing picks.'
                    : !isDraftPositionConfirmed
                      ? `${String(draftSlotsCount)}-team draft found · choose your slot to start importing picks.`
                    : `${String(totalPicks)} picks synced · ${String(myPicksCount)} yours · slot ${String(myPickPosition)} · updates every second`}
            </p>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <DataConfidenceItem
                tone={
                  isError
                    ? 'bad'
                    : connectedDraftId && !isConnecting && isDraftPositionConfirmed
                      ? 'good'
                      : 'neutral'
                }
              >
                {isError
                  ? 'Draft sync needs attention'
                  : isConnecting
                    ? 'Draft sync connecting'
                    : connectedDraftId && isDraftPositionConfirmed
                      ? isComplete
                        ? 'Draft sync complete'
                        : isDrafting
                          ? 'Live draft connected'
                          : 'Draft sync ready'
                      : 'Live draft not connected'}
              </DataConfidenceItem>
              <DataConfidenceItem tone={marketTone} title={marketTitle}>
                {marketAge
                  ? `Market data refreshed ${marketAge}`
                  : 'Market data unavailable'}
              </DataConfidenceItem>
              <DataConfidenceItem
                tone={predictionsError ? 'bad' : hasPredictionModel ? 'good' : 'warn'}
                title={hasPredictionModel ? `Model: ${predictionModelVersion}` : undefined}
              >
                {predictionsError
                  ? 'Model unavailable'
                  : hasPredictionModel
                    ? 'Model ready'
                    : 'Model not loaded'}
              </DataConfidenceItem>
              {contractsError && (
                <DataConfidenceItem tone="warn">
                  Contract data unavailable
                </DataConfidenceItem>
              )}
            </div>
          </div>
        </div>

        <DialogTrigger asChild>
          <Button
            variant={connectedDraftId && !isError ? 'outline' : 'default'}
            size="sm"
            className="shrink-0"
          >
            {!connectedDraftId
              ? 'Connect Sleeper'
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

      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="size-5 text-green-600" />
            Sleeper draft sync
          </DialogTitle>
          <DialogDescription>
            Connect once to keep players, recommendations, and your roster aligned
            with the live draft room.
          </DialogDescription>
        </DialogHeader>
        {dialogContent}
      </DialogContent>
    </Dialog>
  );
}
