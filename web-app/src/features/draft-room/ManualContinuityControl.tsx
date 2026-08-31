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
import { Select } from '@/components/ui/select';
import { usePlayerDataQuery } from '@/hooks/usePlayerData';
import {
  formatRoundPick,
  getPickNumberForTeamRound,
  getTeamIndexForPick,
} from '@/lib/mock-draft-engine';
import { cn } from '@/lib/utils';
import {
  useDraftStore,
  type RecordedDraftPick,
} from '@/stores/draftStore';
import { useLiveDraftSync } from './LiveDraftSyncProvider';

function getTeamName(
  teamIndex: number,
  myTeamIndex: number,
  history: ReturnType<typeof useDraftStore.getState>['draftHistory']
): string {
  if (teamIndex === myTeamIndex) return 'My Team';

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const pick = history[index];
    if (
      pick?.teamIndex === teamIndex &&
      pick.teamName.trim().length > 0
    ) {
      return pick.teamName;
    }
  }
  return `Team ${String(teamIndex + 1)}`;
}

export function ManualContinuityControl(): React.ReactElement | null {
  const {
    canEnterManualContinuity,
    enterManualContinuity,
    lastConfirmedPickNumber,
    provisionalPickCount,
    synchronizationState,
    viewState,
  } = useLiveDraftSync();
  const { players } = usePlayerDataQuery();
  const config = useDraftStore((state) => state.config);
  const currentPick = useDraftStore((state) => state.currentPick);
  const draftedPlayerIds = useDraftStore((state) => state.draftedPlayerIds);
  const draftHistory = useDraftStore((state) => state.draftHistory);
  const preloadedKeepers = useDraftStore((state) => state.preloadedKeepers);
  const recordProvisionalPick = useDraftStore(
    (state) => state.recordProvisionalPick
  );
  const correctProvisionalPick = useDraftStore(
    (state) => state.correctProvisionalPick
  );
  const removeProvisionalPick = useDraftStore(
    (state) => state.removeProvisionalPick
  );
  const [isDialogOpen, setIsDialogOpen] = React.useState(false);
  const [editingPickNumber, setEditingPickNumber] = React.useState<
    number | null
  >(null);
  const [pendingRemovalPickNumber, setPendingRemovalPickNumber] =
    React.useState<number | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = React.useState('');
  const [selectedPickNumber, setSelectedPickNumber] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
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
  const selectablePlayers = React.useMemo(
    () => players
      .filter((player) =>
        !draftedPlayerIds.has(player.id) || player.id === editingPick?.playerId
      )
      .sort((left, right) => left.ecrRank - right.ecrRank),
    [draftedPlayerIds, editingPick?.playerId, players]
  );
  const openPickNumbers = React.useMemo(() => {
    const occupied = new Set(draftHistory.map((pick) => pick.pickNumber));
    for (const keeper of preloadedKeepers) {
      occupied.add(getPickNumberForTeamRound(
        keeper.teamIndex,
        keeper.round,
        config.totalTeams
      ));
    }
    return Array.from(
      { length: config.totalTeams * config.totalRounds },
      (_, index) => index + 1
    ).filter((pickNumber) => !occupied.has(pickNumber));
  }, [config.totalRounds, config.totalTeams, draftHistory, preloadedKeepers]);
  const editablePickNumbers = React.useMemo(() => {
    const pickNumbers = [...openPickNumbers];
    if (
      editingPick &&
      !pickNumbers.includes(editingPick.pickNumber)
    ) {
      pickNumbers.push(editingPick.pickNumber);
    }
    return pickNumbers.sort((left, right) => left - right);
  }, [editingPick, openPickNumbers]);

  React.useEffect(() => {
    if (!selectablePlayers.some((player) => player.id === selectedPlayerId)) {
      setSelectedPlayerId(selectablePlayers[0]?.id ?? '');
    }
  }, [selectablePlayers, selectedPlayerId]);

  React.useEffect(() => {
    if (editablePickNumbers.includes(Number(selectedPickNumber))) return;
    const nextPick = editablePickNumbers.includes(currentPick)
      ? currentPick
      : editablePickNumbers[0];
    setSelectedPickNumber(nextPick === undefined ? '' : String(nextPick));
  }, [currentPick, editablePickNumbers, selectedPickNumber]);

  if (!canEnterManualContinuity && synchronizationState !== 'manual-continuity') {
    return null;
  }

  const openEntryDialog = (): void => {
    setError(null);
    setEditingPickNumber(null);
    setSelectedPlayerId(
      players
        .filter((player) => !draftedPlayerIds.has(player.id))
        .sort((left, right) => left.ecrRank - right.ecrRank)[0]?.id ?? ''
    );
    const nextPick = openPickNumbers.includes(currentPick)
      ? currentPick
      : openPickNumbers[0];
    setSelectedPickNumber(nextPick === undefined ? '' : String(nextPick));
    setIsDialogOpen(true);
  };
  const openCorrectionDialog = (pick: RecordedDraftPick): void => {
    setError(null);
    setEditingPickNumber(pick.pickNumber);
    setSelectedPlayerId(pick.playerId);
    setSelectedPickNumber(String(pick.pickNumber));
    setIsDialogOpen(true);
  };
  const handleDialogOpenChange = (open: boolean): void => {
    setIsDialogOpen(open);
    if (!open) {
      setEditingPickNumber(null);
      setError(null);
    }
  };
  const handleEnterManualContinuity = (): void => {
    enterManualContinuity();
    openEntryDialog();
  };
  const handleSave = (): void => {
    const player = selectablePlayers.find(
      (candidate) => candidate.id === selectedPlayerId
    );
    const pickNumber = Number.parseInt(selectedPickNumber, 10);
    if (!player || !Number.isInteger(pickNumber)) {
      setError('Choose an available player and draft position.');
      return;
    }

    const teamIndex = getTeamIndexForPick(pickNumber, config.totalTeams);
    const replacement = {
      pickNumber,
      playerId: player.id,
      playerName: player.name,
      position: player.position,
      teamIndex,
      teamName: getTeamName(
        teamIndex,
        config.myPickPosition - 1,
        draftHistory
      ),
    };
    const saved = editingPick
      ? correctProvisionalPick(editingPick.pickNumber, replacement)
      : recordProvisionalPick(replacement);
    if (!saved) {
      setError(editingPick
        ? 'Choose a different player or an open draft position.'
        : 'That player or draft position is no longer available.');
      return;
    }

    setError(null);
    setIsDialogOpen(false);
    setEditingPickNumber(null);
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
                    ? 'Sleeper is disconnected'
                    : 'Sleeper updates are delayed'}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {lastTruthLabel}{' '}
                {isManual
                  ? `${String(provisionalPickCount)} ${provisionalPickCount === 1 ? 'Provisional Pick is' : 'Provisional Picks are'} local only and will never be submitted or queued with Sleeper.`
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

      <Dialog open={isDialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingPick
                ? 'Correct a Provisional Pick'
                : 'Record a Provisional Pick'}
            </DialogTitle>
            <DialogDescription>
              {editingPick
                ? 'Replace the observed player or draft position. Confirmed Provider Truth stays locked.'
                : 'Record the selection you saw in Sleeper. The local draft state will update, but this action cannot submit or queue a provider pick.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <label className="block space-y-1.5 text-sm font-semibold">
              <span>Observed player</span>
              <Select
                className="w-full"
                aria-label="Observed player"
                value={selectedPlayerId}
                onValueChange={setSelectedPlayerId}
                options={selectablePlayers.map((player) => ({
                  value: player.id,
                  label: `${player.name} · ${player.position} ${player.team} · ECR #${String(player.ecrRank)}`,
                }))}
              />
            </label>

            <label className="block space-y-1.5 text-sm font-semibold">
              <span>Team and draft position</span>
              <Select
                className="w-full"
                aria-label="Team and draft position"
                value={selectedPickNumber}
                onValueChange={setSelectedPickNumber}
                options={editablePickNumbers.map((pickNumber) => {
                  const teamIndex = getTeamIndexForPick(
                    pickNumber,
                    config.totalTeams
                  );
                  return {
                    value: String(pickNumber),
                    label: `Pick ${formatRoundPick(pickNumber, config.totalTeams)} · #${String(pickNumber)} · ${getTeamName(teamIndex, config.myPickPosition - 1, draftHistory)}`,
                  };
                })}
              />
            </label>

            <div className="rounded-md border border-amber-500/45 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-950 dark:text-amber-100">
              {editingPick
                ? 'The corrected entry stays provisional and remains visible for later Reconciliation.'
                : 'The board will label this as a Provisional Pick. Provider Truth stays intact for later Reconciliation.'}
            </div>
            {error ? (
              <p className="text-xs font-semibold text-destructive" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { handleDialogOpenChange(false); }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={
                !selectedPlayerId ||
                !selectedPickNumber ||
                Boolean(
                  editingPick &&
                  editingPick.playerId === selectedPlayerId &&
                  editingPick.pickNumber === Number(selectedPickNumber)
                )
              }
            >
              {editingPick
                ? 'Save Correction'
                : 'Record Provisional Pick'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
