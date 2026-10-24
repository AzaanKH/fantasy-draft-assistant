import { STORAGE_ACTIVATION_ENABLED } from '@fantasy-draft/shared/sync';
import { requestWorkspace } from '@/workspace/ui-dispatch';
import { useWorkspace, useDraftState } from '@/workspace/WorkspaceProvider';
import { useDraftView } from '@/workspace/useDraftView';
import { createSlotSequence } from '@fantasy-draft/shared/draft';
import { RANKING_LABELS } from '@/lib/demo-mode';
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
import { getProviderName } from '@/lib/provider-name';
import { type RecordedDraftPick } from '@/stores/draftStore';
import { useLiveDraftSync } from './LiveDraftSyncProvider';

function getTeamName(
  teamIndex: number,
  myTeamIndex: number,
  history: readonly RecordedDraftPick[]
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
  const { connection } = useLiveDraftSync();
  const config = useDraftState((state) => state.config);
  const currentPick = useDraftView((view) => view.currentPick);
  const draftedPlayerIds = useDraftView((view) => view.draftedPlayerIds);
  const [pending, setPending] = React.useState(false);
  const canRecord = useDraftView((view) => view.canRecord);
  const draftHistory = useDraftState((state) => state.draftHistory);
  const preloadedKeepers = useDraftState((state) => state.preloadedKeepers);
  const workspace = useWorkspace();

  const selectablePlayers = React.useMemo(
    () => players
      .filter((player) => !draftedPlayerIds.has(player.id) || player.id === editingPick?.playerId)
      .sort((left, right) => left.ecrRank - right.ecrRank),
    [draftedPlayerIds, editingPick?.playerId, players]
  );
  const order = React.useMemo(() => createSlotSequence({
    type: config.draftType, teams: config.totalTeams, rounds: config.totalRounds,
  }), [config.draftType, config.totalTeams, config.totalRounds]);
  const openPickNumbers = React.useMemo(() => {
    const occupied = new Set(draftHistory.map((pick) => pick.pickNumber));
    for (const keeper of preloadedKeepers) {
      occupied.add(order.forTeamRound(keeper.teamIndex, keeper.round).pick);
    }
    return Array.from(
      { length: config.totalTeams * config.totalRounds },
      (_, index) => index + 1
    ).filter((pickNumber) => !occupied.has(pickNumber));
  }, [config.totalRounds, config.totalTeams, order, draftHistory, preloadedKeepers]);
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

  // A native select falls back to another enabled option when its selected
  // option disappears. Render the invalid state in the same commit, before
  // passive effects persist the cleared choice.
  const selectedPickAvailable = editablePickNumbers.includes(Number(selectedPickNumber));
  const displayedPickNumber = selectedPickAvailable ? selectedPickNumber : '';
  const displayedError = !pending && selectedPickNumber && !selectedPickAvailable
    ? `Pick ${selectedPickNumber} was just recorded elsewhere. Choose a pick.`
    : error;

  React.useEffect(() => {
    if (!selectablePlayers.some((player) => player.id === selectedPlayerId)) {
      setSelectedPlayerId(selectablePlayers[0]?.id ?? '');
    }
  }, [selectablePlayers, selectedPlayerId]);

  React.useEffect(() => {
    if (pending || !selectedPickNumber || editablePickNumbers.includes(Number(selectedPickNumber))) return;
    setError(`Pick ${selectedPickNumber} was just recorded elsewhere. Choose a pick.`);
    setSelectedPickNumber('');
  }, [editablePickNumbers, pending, selectedPickNumber]);

  const handleSave = async (): Promise<void> => {
    if (pending) return;
    const player = selectablePlayers.find(
      (candidate) => candidate.id === selectedPlayerId
    );
    const pickNumber = Number.parseInt(selectedPickNumber, 10);
    if (!player || !Number.isInteger(pickNumber)) {
      setError('Choose an available player and draft position.');
      return;
    }

    const teamIndex = order.at(pickNumber).teamIndex;
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
    setPending(true);
    let saved: boolean;
    try {
      const outcome = editingPick
        ? (STORAGE_ACTIVATION_ENABLED ? requestWorkspace(workspace, 'correctProvisionalPick', editingPick.pickNumber, replacement) : workspace.send('correctProvisionalPick', editingPick.pickNumber, replacement))
        : (STORAGE_ACTIVATION_ENABLED ? requestWorkspace(workspace, 'recordProvisionalPick', replacement) : workspace.send('recordProvisionalPick', replacement));
      saved = outcome instanceof Promise ? await outcome : outcome;
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      return;
    } finally { setPending(false); }
    if (!saved) {
      setError(editingPick
        ? 'Choose a different player or an open draft position.'
        : 'That player or draft position is no longer available.');
      return;
    }

    setSelectedPickNumber('');
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
            : `Record the selection you saw in ${connection ? getProviderName(connection.provider) : 'your draft room'}. The local draft state will update, but this action cannot submit or queue a provider pick.`}
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
              label: `${player.name} · ${player.position} ${player.team} · ${RANKING_LABELS.short} #${String(player.ecrRank)}`,
            }))}
          />
        </label>

        <label className="block space-y-1.5 text-sm font-semibold">
          <span>Team and draft position</span>
          <Select
            className="w-full"
            aria-label="Team and draft position"
            value={displayedPickNumber}
            onValueChange={(value) => { setSelectedPickNumber(value); setError(null); }}
            options={[{ value: '', label: 'Choose a pick', disabled: true }, ...editablePickNumbers.map((pickNumber) => {
              const teamIndex = order.at(pickNumber).teamIndex;
              return {
                value: String(pickNumber),
                label: `Pick ${order.label(pickNumber)} · #${String(pickNumber)} · ${getTeamName(teamIndex, config.myPickPosition - 1, draftHistory)}`,
              };
            })]}
          />
        </label>

        <div className="rounded-md border border-amber-500/45 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-950 dark:text-amber-100">
          {editingPick
            ? 'The corrected entry stays provisional and remains visible for later Reconciliation.'
            : 'The board will label this as a Provisional Pick. Provider Truth stays intact for later Reconciliation.'}
        </div>
        {displayedError ? (
          <p className="text-xs font-semibold text-destructive" role="alert">
            {displayedError}
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={() => { void handleSave(); }}
          disabled={pending || !canRecord ||
            !selectedPlayerId ||
            !displayedPickNumber ||
            Boolean(
              editingPick &&
              editingPick.playerId === selectedPlayerId &&
              editingPick.pickNumber === Number(selectedPickNumber)
            )
          }
        >
          {pending ? 'Saving...' : editingPick
            ? 'Save Correction'
            : 'Record Provisional Pick'}
        </Button>
      </DialogFooter>
    </>
  );
}
