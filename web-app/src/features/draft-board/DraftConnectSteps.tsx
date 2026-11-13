/**
 * The step bodies of the live draft sync dialog: enter a draft, wait for the
 * first snapshot, recover from errors, choose a slot, and manage an active sync.
 */
import * as React from 'react';
import { CircleAlert, LoaderCircle, RefreshCw, Unplug } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { DraftProvider } from '@fantasy-draft/shared/sync';
import type { QuickMockPreferences } from '@fantasy-draft/shared/draft';
import { formatDraftSyncAge } from '@/hooks/useDraftSync';
import { cn } from '@/lib/utils';
import { DraftSyncStatusIndicator } from '@/features/draft-room/DraftSyncStatusIndicator';
import type { useLiveDraftSync } from '@/features/draft-room/LiveDraftSyncProvider';
import { providerLabel } from './draft-connect-parsing';
import { SyncDetail } from './DraftConnectPanels';

type LiveDraftSync = ReturnType<typeof useLiveDraftSync>;

const DRAFT_INPUT_ERROR_ID = 'provider-draft-id-error';

export function DraftEntryStep({
  provider,
  onProviderChange,
  draftIdInput,
  onDraftIdChange,
  inputError,
  inputRef,
  onConnect,
}: {
  readonly provider: DraftProvider;
  readonly onProviderChange: (provider: DraftProvider) => void;
  readonly draftIdInput: string;
  readonly onDraftIdChange: (value: string) => void;
  readonly inputError: string | null;
  readonly inputRef: React.Ref<HTMLInputElement>;
  readonly onConnect: () => void;
}): React.ReactElement {
  const label = providerLabel(provider);
  return (
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
              onProviderChange(value);
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
          {label} draft URL or ID
        </label>
        <Input
          id="provider-draft-id"
          ref={inputRef}
          autoFocus
          aria-invalid={inputError ? true : undefined}
          aria-describedby={inputError ? `${DRAFT_INPUT_ERROR_ID} provider-draft-id-hint` : 'provider-draft-id-hint'}
          placeholder={
            provider === 'yahoo'
              ? 'https://football.fantasysports.yahoo.com/f1/...'
              : provider === 'espn'
                ? 'https://fantasy.espn.com/football/draft?leagueId=...'
                : 'https://sleeper.com/draft/nfl/...'
          }
          value={draftIdInput}
          onChange={(event) => {
            onDraftIdChange(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              onConnect();
            }
          }}
        />
        {inputError ? (
          <p id={DRAFT_INPUT_ERROR_ID} role="alert" className="text-xs font-semibold text-danger">
            {inputError}
          </p>
        ) : null}
        <p id="provider-draft-id-hint" className="text-xs leading-relaxed text-muted-foreground">
          Open your {label} draft room and paste its URL, or enter the
          provider ID from that URL directly.
        </p>
      </div>

      <div className="rounded-md border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
        {provider === 'espn'
          ? 'ESPN picks come from the Chrome extension. Log into ESPN normally and keep the live draft tab open; the app never receives your ESPN credentials.'
          : 'Picks import automatically every second from the provider\'s read-only server endpoint. Login is not required.'}
      </div>

      <DialogFooter>
        <Button onClick={onConnect} disabled={!draftIdInput.trim()}>
          Continue
        </Button>
      </DialogFooter>
    </div>
  );
}

export function ConnectingStep({
  provider,
  onDisconnect,
}: {
  readonly provider: DraftProvider;
  readonly onDisconnect: () => void;
}): React.ReactElement {
  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <LoaderCircle className="size-8 animate-spin text-green-600" />
        <div>
          <div className="font-semibold">Connecting to {providerLabel(provider)}...</div>
          <p className="mt-1 text-sm text-muted-foreground">
            Fetching the draft room and importing picks.
          </p>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDisconnect}>
          <Unplug />
          Disconnect
        </Button>
      </DialogFooter>
    </div>
  );
}

export function SyncErrorStep({
  provider,
  lastError,
  onDisconnect,
}: {
  readonly provider: DraftProvider;
  readonly lastError: string | null;
  readonly onDisconnect: () => void;
}): React.ReactElement {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-danger/50 bg-danger/10 p-4">
        <div className="flex items-center gap-2 font-semibold text-danger">
          <CircleAlert className="size-4" />
          {providerLabel(provider)} draft could not be synced
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {lastError ?? 'Check the draft URL or ID and try again.'}
        </p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDisconnect}>
          Edit draft details
        </Button>
      </DialogFooter>
    </div>
  );
}

function slotOptions(draftSlots: readonly number[]) {
  return draftSlots.map((position) => ({ value: String(position), label: `Slot ${String(position)}` }));
}

export function DraftSlotStep({
  draftPosition,
  onDraftPositionChange,
  draftSlots,
  isValid,
  onConfirm,
  onDisconnect,
}: {
  readonly draftPosition: string;
  readonly onDraftPositionChange: (value: string) => void;
  readonly draftSlots: readonly number[];
  readonly isValid: boolean;
  readonly onConfirm: () => void;
  readonly onDisconnect: () => void;
}): React.ReactElement {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <label className="text-sm font-medium">Your draft slot</label>
        <div className="flex items-center gap-3">
          <Select
            aria-label="Your draft slot"
            className="w-28"
            value={draftPosition}
            onValueChange={onDraftPositionChange}
            options={slotOptions(draftSlots)}
          />
          <span className="text-xs text-muted-foreground">
            Used to identify your picks and build your roster.
          </span>
        </div>
      </div>

      <DialogFooter className="sm:justify-between">
        <Button variant="outline" onClick={onDisconnect}>
          <Unplug />
          Disconnect
        </Button>
        <Button onClick={onConfirm} disabled={!isValid}>
          Start syncing
        </Button>
      </DialogFooter>
    </div>
  );
}

export function ConnectedSyncStep({
  provider,
  sync,
  syncViewState,
  synchronizationState,
  lastSyncAgeMs,
  myPickPosition,
  draftSlots,
  onConfirmDraftPosition,
  isRefreshing,
  onRefresh,
  onDisconnect,
  onDone,
}: {
  readonly provider: DraftProvider;
  readonly sync: LiveDraftSync['sync'];
  readonly syncViewState: LiveDraftSync['viewState'];
  readonly synchronizationState: LiveDraftSync['synchronizationState'];
  readonly lastSyncAgeMs: number | null;
  readonly myPickPosition: number;
  readonly draftSlots: readonly number[];
  readonly onConfirmDraftPosition: (position: number) => void;
  readonly isRefreshing: boolean;
  readonly onRefresh: () => void;
  readonly onDisconnect: () => void;
  readonly onDone: () => void;
}): React.ReactElement {
  const { draft, totalPicks, myPicksCount, connectionState, isDrafting, isPaused, isComplete, importWarning, rejectedPickCount } = sync;
  const isSyncDegraded =
    connectionState === 'reconnecting' ||
    connectionState === 'stale' ||
    synchronizationState === 'manual-continuity';
  return (
    <div className="space-y-4">
      <div className={cn(
        'rounded-md border p-4',
        isSyncDegraded
          ? 'border-warning/45 bg-warning/10'
          : 'border-green-500/40 bg-green-500/10'
      )}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold">
          <span>{providerLabel(provider)} draft</span>
          <DraftSyncStatusIndicator sync={syncViewState} />
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {synchronizationState === 'manual-continuity'
            ? 'Manual Continuity is active. The provider\'s last synced picks stay loaded, and Provisional Picks stay local until sync returns and they can be checked.'
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
        <div className="rounded-md border border-warning/50 bg-warning/10 p-4">
          <div className="flex items-center gap-2 font-semibold text-warning">
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
        <SyncDetail label="Your slot">
          <Select aria-label="Your draft slot" value={String(myPickPosition)}
            onValueChange={value => { onConfirmDraftPosition(Number(value)); }}
            options={slotOptions(draftSlots)} />
        </SyncDetail>
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
            <span className="text-warning">
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
        <Button variant="outline" onClick={onDisconnect}>
          <Unplug />
          Disconnect
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onRefresh} disabled={isRefreshing}>
            <RefreshCw className={cn(isRefreshing && 'animate-spin')} />
            Refresh now
          </Button>
          <Button onClick={onDone}>
            Done
          </Button>
        </div>
      </DialogFooter>
    </div>
  );
}

export function PracticeSettingsControl({
  settingsProfile,
  quickMockPreferences,
  onChange,
}: {
  readonly settingsProfile: string;
  readonly quickMockPreferences: QuickMockPreferences;
  readonly onChange: (value: string) => void;
}): React.ReactElement {
  return (
    <div className="space-y-2 border-y border-border py-3">
      <label htmlFor="draft-settings-profile" className="block text-sm font-medium">Rules for this draft</label>
      <Select id="draft-settings-profile" className="w-full" value={settingsProfile} options={[
        { value: 'quick-mock', label: 'Quick mock · Default league rules' },
        { value: 'primary-league-mock', label: 'Practice with Primary League rules' },
        { value: 'provider', label: 'Actual Primary League · Verify with Sleeper' },
      ]} onValueChange={onChange} />
      <p className="text-xs leading-relaxed text-muted-foreground">
        {settingsProfile === 'quick-mock'
          ? `${quickMockPreferences.reception === 1 ? 'Full PPR' : quickMockPreferences.reception === 0.5 ? 'Half PPR' : 'Standard scoring'}, ${String(quickMockPreferences.passingTouchdown)}-point passing touchdowns, no premiums or keepers. No Primary League setup required. Sleeper supplies picks, teams, and rounds; use at least 10 rounds.`
          : settingsProfile === 'primary-league-mock'
            ? 'Full PPR, +0.5 TE premium, +0.2 per rush, 4-point passing touchdowns, and Primary League keepers. Use a 10-team mock with at least 14 rounds.'
            : 'Use this for your actual league draft. Scoring, roster settings, and keepers must match the Primary League.'}
      </p>
    </div>
  );
}
