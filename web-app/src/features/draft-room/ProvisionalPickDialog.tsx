import * as React from 'react';
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
import {
  useDraftStore,
  type RecordedDraftPick,
} from '@/stores/draftStore';

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

/**
 * Records or corrects a Provisional Pick during Manual Continuity.
 * `initialPlayerId` preselects an observed player for a new entry when that player is still available.
 */
export function ProvisionalPickDialog({
  open,
  onOpenChange,
  editingPick,
  initialPlayerId,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly editingPick?: RecordedDraftPick;
  readonly initialPlayerId?: string;
}): React.ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* DialogContent mounts on open, so the form starts from the current draft state each time. */}
        <ProvisionalPickForm
          editingPick={editingPick}
          initialPlayerId={initialPlayerId}
          onClose={() => { onOpenChange(false); }}
        />
      </DialogContent>
    </Dialog>
  );
}

function ProvisionalPickForm({
  editingPick,
  initialPlayerId,
  onClose,
}: {
  readonly editingPick?: RecordedDraftPick;
  readonly initialPlayerId?: string;
  readonly onClose: () => void;
}): React.ReactElement {
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

  const [selectedPlayerId, setSelectedPlayerId] = React.useState(() => {
    if (editingPick) return editingPick.playerId;
    return selectablePlayers.find((player) => player.id === initialPlayerId)?.id
      ?? selectablePlayers[0]?.id
      ?? '';
  });
  const [selectedPickNumber, setSelectedPickNumber] = React.useState(() => {
    if (editingPick) return String(editingPick.pickNumber);
    const nextPick = openPickNumbers.includes(currentPick)
      ? currentPick
      : openPickNumbers[0];
    return nextPick === undefined ? '' : String(nextPick);
  });
  const [error, setError] = React.useState<string | null>(null);

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

    onClose();
  };

  return (
    <>
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
        <Button variant="outline" onClick={onClose}>
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
    </>
  );
}
