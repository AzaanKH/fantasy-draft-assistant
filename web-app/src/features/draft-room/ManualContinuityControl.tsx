import * as React from 'react';
import { CircleAlert, PenLine, ShieldAlert, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatRoundPick } from '@/lib/mock-draft-engine';
import { getProviderName } from '@/lib/provider-name';
import { cn } from '@/lib/utils';
import {
  useDraftStore,
  type RecordedDraftPick,
} from '@/stores/draftStore';
import { useLiveDraftSync } from './LiveDraftSyncProvider';
import { ProvisionalPickDialog } from './ProvisionalPickDialog';

export function ManualContinuityControl(): React.ReactElement | null {
  const {
    canEnterManualContinuity,
    connection,
    enterManualContinuity,
    lastConfirmedPickNumber,
    provisionalPickCount,
    synchronizationState,
    viewState,
  } = useLiveDraftSync();
  const config = useDraftStore((state) => state.config);
  const draftHistory = useDraftStore((state) => state.draftHistory);
  const removeProvisionalPick = useDraftStore(
    (state) => state.removeProvisionalPick
  );
  const [isDialogOpen, setIsDialogOpen] = React.useState(false);
  const [editingPickNumber, setEditingPickNumber] = React.useState<
    number | null
  >(null);
  const [pendingRemovalPickNumber, setPendingRemovalPickNumber] =
    React.useState<number | null>(null);
  const [removalError, setRemovalError] = React.useState<string | null>(null);

  const provisionalPicks = React.useMemo(
    () => draftHistory.filter((pick) => pick.source === 'provisional'),
    [draftHistory]
  );
  const editingPick = React.useMemo(
    () => provisionalPicks.find(
      (pick) => pick.pickNumber === editingPickNumber
    ),
    [editingPickNumber, provisionalPicks]
  );
  const pendingRemovalPick = React.useMemo(
    () => provisionalPicks.find(
      (pick) => pick.pickNumber === pendingRemovalPickNumber
    ),
    [pendingRemovalPickNumber, provisionalPicks]
  );

  if (!canEnterManualContinuity && synchronizationState !== 'manual-continuity') {
    return null;
  }

  const openEntryDialog = (): void => {
    setEditingPickNumber(null);
    setIsDialogOpen(true);
  };
  const openCorrectionDialog = (pick: RecordedDraftPick): void => {
    setEditingPickNumber(pick.pickNumber);
    setIsDialogOpen(true);
  };
  const handleDialogOpenChange = (open: boolean): void => {
    setIsDialogOpen(open);
    if (!open) setEditingPickNumber(null);
  };
  const handleEnterManualContinuity = (): void => {
    enterManualContinuity();
    openEntryDialog();
  };
  const openRemovalDialog = (pickNumber: number): void => {
    setRemovalError(null);
    setPendingRemovalPickNumber(pickNumber);
  };
  const handleRemove = (): void => {
    if (!pendingRemovalPick) {
      setRemovalError('This Provisional Pick is no longer available to remove.');
      return;
    }
    if (!removeProvisionalPick(pendingRemovalPick.pickNumber)) {
      setRemovalError('Only a local Provisional Pick can be removed.');
      return;
    }
    setRemovalError(null);
    setPendingRemovalPickNumber(null);
  };

  const lastTruthLabel = lastConfirmedPickNumber > 0
    ? `Provider Truth through pick #${String(lastConfirmedPickNumber)} remains loaded.`
    : 'The last confirmed Provider Truth remains loaded.';
  const isManual = synchronizationState === 'manual-continuity';
  const providerName = getProviderName(connection?.provider ?? null);

  return (
    <>
      <section
        className={cn(
          'flex flex-col gap-3 rounded-xl border px-4 py-3 shadow-sm',
          isManual
            ? 'border-amber-500/55 bg-amber-500/10'
            : viewState.connectionState === 'error'
              ? 'border-destructive/45 bg-destructive/5'
              : 'border-amber-500/45 bg-amber-500/[0.07]'
        )}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3" role="status" aria-live="polite">
            {isManual ? (
              <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-300" />
            ) : (
              <CircleAlert className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-300" />
            )}
            <div className="min-w-0">
              <h2 className="text-sm font-bold">
                {isManual
                  ? 'Manual Continuity is active'
                  : viewState.connectionState === 'error'
                    ? `${providerName} is disconnected`
                    : `${providerName} updates are delayed`}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {lastTruthLabel}{' '}
                {isManual
                  ? `${String(provisionalPickCount)} ${provisionalPickCount === 1 ? 'Provisional Pick is' : 'Provisional Picks are'} local only and will never be submitted or queued with ${connection ? providerName : 'the provider'}.`
                  : 'Enter Manual Continuity to record selections you observe without changing the confirmed provider history.'}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant={isManual ? 'outline' : 'default'}
            className={cn(isManual && 'border-amber-500/55 bg-background/70')}
            onClick={isManual ? openEntryDialog : handleEnterManualContinuity}
          >
            <PenLine />
            {isManual ? 'Add Provisional Pick' : 'Enter Manual Continuity'}
          </Button>
        </div>

        {isManual && provisionalPicks.length > 0 ? (
          <div className="border-t border-amber-500/30 pt-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-amber-900 dark:text-amber-100">
                Local picks awaiting Reconciliation
              </h3>
              <span className="text-[11px] text-muted-foreground">
                Confirmed picks are locked
              </span>
            </div>
            <div className="space-y-2" role="list" aria-label="Provisional Picks">
              {provisionalPicks.map((pick) => (
                <div
                  key={pick.pickNumber}
                  className="flex flex-col gap-2 rounded-md border border-amber-500/35 bg-background/70 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                  role="listitem"
                  aria-label={`${pick.playerName}, ${pick.position}, pick ${formatRoundPick(pick.pickNumber, config.totalTeams)}, ${pick.teamName}, ${pick.provisionalRevision ? `corrected locally ${String(pick.provisionalRevision)} ${pick.provisionalRevision === 1 ? 'time' : 'times'}` : 'recorded locally'}`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {pick.playerName}
                      <span className="ml-1.5 font-normal text-muted-foreground">
                        {pick.position}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Pick {formatRoundPick(pick.pickNumber, config.totalTeams)} · #{String(pick.pickNumber)} · {pick.teamName}
                      {pick.provisionalRevision
                        ? ` · Corrected locally ${String(pick.provisionalRevision)} ${pick.provisionalRevision === 1 ? 'time' : 'times'}`
                        : ' · Recorded locally'}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => { openCorrectionDialog(pick); }}
                      aria-label={`Correct Provisional Pick for ${pick.playerName}`}
                    >
                      <PenLine />
                      Correct
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => { openRemovalDialog(pick.pickNumber); }}
                      aria-label={`Remove Provisional Pick for ${pick.playerName}`}
                    >
                      <Trash2 />
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <ProvisionalPickDialog
        open={isDialogOpen}
        onOpenChange={handleDialogOpenChange}
        editingPick={editingPick}
      />

      <Dialog
        open={pendingRemovalPickNumber !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingRemovalPickNumber(null);
            setRemovalError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove this Provisional Pick?</DialogTitle>
            <DialogDescription>
              {pendingRemovalPick
                ? `${pendingRemovalPick.playerName} will return to the available-player pool and pick #${String(pendingRemovalPick.pickNumber)} will reopen. Confirmed Provider Truth will not change.`
                : 'This local entry is no longer available.'}
            </DialogDescription>
          </DialogHeader>
          {removalError ? (
            <p className="text-xs font-semibold text-destructive" role="alert">
              {removalError}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setPendingRemovalPickNumber(null); }}
            >
              Keep Provisional Pick
            </Button>
            <Button
              variant="destructive"
              onClick={handleRemove}
              disabled={!pendingRemovalPick}
            >
              <Trash2 />
              Remove Provisional Pick
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
