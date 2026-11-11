import { requestWorkspace } from '@/workspace/ui-dispatch';
import { usePickLock, usePickOrigin, type PickFailure, type PickLock } from '@/workspace/pick-in-flight';
import type { Workspace } from '@/workspace/workspace';
import type { Position } from '@fantasy-draft/shared/league';
import { useStore } from 'zustand';
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

type SaveOutcome = 'saved' | 'rejected' | 'failed' | 'locked';

interface ProvisionalReplacement {
  readonly pickNumber: number;
  readonly playerId: string;
  readonly playerName: string;
  readonly position: Position;
  readonly teamIndex: number;
  readonly teamName: string;
}

/**
 * One Record (or correction) save under the shared pick lock. While the dialog is open it shows the outcome
 * itself; once closed, a failure or a refused pick goes to the persistent workspace notice, whose Retry runs this
 * same save again. The workspace command re-checks the player and slot, so a retry for a player or pick taken in
 * the meantime is refused and reported rather than recorded elsewhere.
 */
function saveProvisionalPick({ workspace, pickLock, origin, replacement, editingPickNumber, isOpen }: {
  readonly workspace: Workspace;
  readonly pickLock: PickLock;
  readonly origin: string;
  readonly replacement: ProvisionalReplacement;
  readonly editingPickNumber: number | undefined;
  readonly isOpen: () => boolean;
}): SaveOutcome | Promise<SaveOutcome> {
  const attempt = {
    playerId: replacement.playerId,
    playerName: replacement.playerName,
    origin,
    retry: pickLock.bindRetry(() => { void saveProvisionalPick({ workspace, pickLock, origin, replacement, editingPickNumber, isOpen: () => false }); }),
  };
  if (!pickLock.begin(attempt)) return 'locked';
  const fail = (error: unknown): SaveOutcome => {
    // One surface for the failure: the open dialog shows it itself, a closed one hands it to the persistent
    // workspace notice (which no mounted control reports for this origin). Either way the generic save notice
    // is cleared so it is not shown twice or left behind.
    workspace.dismissError?.();
    pickLock.settle(attempt, `${replacement.playerName} was not recorded. ${error instanceof Error ? error.message : String(error)}`);
    return 'failed';
  };
  const finish = (saved: boolean): SaveOutcome => {
    pickLock.settle(attempt, saved || isOpen() ? undefined : `${replacement.playerName} was not recorded. That player or draft position is no longer available.`);
    return saved ? 'saved' : 'rejected';
  };
  let outcome: boolean | Promise<boolean>;
  try {
    outcome = editingPickNumber === undefined
      ? requestWorkspace(workspace, 'recordProvisionalPick', replacement)
      : requestWorkspace(workspace, 'correctProvisionalPick', editingPickNumber, replacement);
  } catch (error) {
    return fail(error);
  }
  // A synchronous (v1) save finishes in this same call, so the dialog closes in the commit that records the pick.
  return outcome instanceof Promise ? outcome.then(finish, fail) : finish(outcome);
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
          open={open}
          editingPick={editingPick}
          initialPlayerId={initialPlayerId}
          onClose={() => { onOpenChange(false); }}
        />
      </DialogContent>
    </Dialog>
  );
}

function ProvisionalPickForm({
  open,
  editingPick,
  initialPlayerId,
  onClose,
}: {
  readonly open: boolean;
  readonly editingPick?: RecordedDraftPick;
  readonly initialPlayerId?: string;
  readonly onClose: () => void;
}): React.ReactElement {
  const { players } = usePlayerDataQuery();
  const { connection } = useLiveDraftSync();
  const config = useDraftState((state) => state.config);
  const currentPick = useDraftView((view) => view.currentPick);
  const draftedPlayerIds = useDraftView((view) => view.draftedPlayerIds);
  const pickLock = usePickLock();
  const pickOrigin = usePickOrigin();
  // The shared lock owns this form's pending and failed state, so its safety timeout also ends "Saving...".
  const pending = useStore(pickLock.store, (state) => state.inFlight?.origin === pickOrigin);
  const ownFailure = useStore(pickLock.store, (state) => state.failure?.origin === pickOrigin ? state.failure : null);
  const lockFailure = ownFailure?.message ?? null;
  // Another Draft or Record save anywhere in the workspace holds the shared pick lock.
  const otherPickInFlight = useStore(pickLock.store, (state) => state.inFlight !== null && state.inFlight.origin !== pickOrigin);
  const canRecord = useDraftView((view) => view.canRecord);
  const draftHistory = useDraftState((state) => state.draftHistory);
  const preloadedKeepers = useDraftState((state) => state.preloadedKeepers);
  const workspace = useWorkspace();
  const mountedRef = React.useRef(true);
  // The failure this open form last rendered, so closing acknowledges only what the user could read.
  const shownFailureRef = React.useRef<PickFailure | null>(null);
  React.useLayoutEffect(() => {
    if (open) shownFailureRef.current = ownFailure;
  }, [open, ownFailure]);
  // While open, the form shows its own save failures. Cancel or Escape can close it while a save is still pending,
  // and the closing form stays mounted for its exit animation: it stops reporting as soon as it closes, so a failure
  // that arrives during or after the exit goes to the persistent workspace notice. A failure already shown here is
  // acknowledged by closing.
  React.useEffect(() => {
    if (!open) return;
    mountedRef.current = true;
    const unmount = pickLock.mountReporter(pickOrigin);
    return () => {
      mountedRef.current = false;
      unmount();
      const failure = pickLock.store.getState().failure;
      if (failure !== null && failure === shownFailureRef.current) pickLock.dismissFailure();
    };
  }, [open, pickLock, pickOrigin]);

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
  const [playerError, setPlayerError] = React.useState<string | null>(null);

  // A native select falls back to another enabled option when its selected
  // option disappears. Render the invalid state in the same commit, before
  // passive effects persist the cleared choice.
  const selectedPickAvailable = editablePickNumbers.includes(Number(selectedPickNumber));
  const displayedPickNumber = selectedPickAvailable ? selectedPickNumber : '';
  const displayedError = !pending && selectedPickNumber && !selectedPickAvailable
    ? `Pick ${selectedPickNumber} was just recorded elsewhere. Choose a pick.`
    : error ?? lockFailure;

  // Same-commit invalidation for the observed player: never substitute another
  // player when the chosen one is recorded elsewhere; require a new choice.
  const selectedPlayerAvailable = !selectedPlayerId ||
    selectablePlayers.some((player) => player.id === selectedPlayerId);
  const displayedPlayerId = selectedPlayerAvailable ? selectedPlayerId : '';
  const lostPlayerMessage = selectedPlayerAvailable
    ? null
    : `${players.find((player) => player.id === selectedPlayerId)?.name ?? 'That player'} was just recorded elsewhere. Choose a player.`;
  const displayedPlayerError = !pending && lostPlayerMessage ? lostPlayerMessage : playerError;

  React.useEffect(() => {
    if (pending || !lostPlayerMessage) return;
    setPlayerError(lostPlayerMessage);
    setSelectedPlayerId('');
  }, [lostPlayerMessage, pending]);

  React.useEffect(() => {
    if (pending || !selectedPickNumber || editablePickNumbers.includes(Number(selectedPickNumber))) return;
    setError(`Pick ${selectedPickNumber} was just recorded elsewhere. Choose a pick.`);
    setSelectedPickNumber('');
  }, [editablePickNumbers, pending, selectedPickNumber]);

  const handleSave = async (): Promise<void> => {
    if (pending) return;
    const player = selectablePlayers.find(
      (candidate) => candidate.id === displayedPlayerId
    );
    const pickNumber = Number(displayedPickNumber);
    if (!player || !displayedPickNumber || !Number.isInteger(pickNumber) || !editablePickNumbers.includes(pickNumber)) {
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
    setError(null);
    const result = saveProvisionalPick({
      workspace, pickLock, origin: pickOrigin, replacement, editingPickNumber: editingPick?.pickNumber,
      isOpen: () => mountedRef.current,
    });
    const outcome = result instanceof Promise ? await result : result;
    if (outcome === 'locked') {
      setError('Another pick is still saving. Try again in a moment.');
      return;
    }
    if (outcome === 'failed' || !mountedRef.current) return;
    if (outcome === 'rejected') {
      // A more specific message ("Pick 3 was just recorded elsewhere") set while the save settled wins.
      const rejected = editingPick
        ? 'Choose a different player or an open draft position.'
        : 'That player or draft position is no longer available.';
      setError((current) => current ?? rejected);
      return;
    }

    setSelectedPickNumber('');
    setSelectedPlayerId('');
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
            ? 'Replace the observed player or draft position. Picks synced from the provider stay locked.'
            : `Record the selection you saw in ${connection ? getProviderName(connection.provider) : 'your draft room'}. The local draft state will update, but this action cannot submit or queue a provider pick.`}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <label className="block space-y-1.5 text-sm font-semibold">
          <span>Observed player</span>
          <Select
            className="w-full"
            aria-label="Observed player"
            value={displayedPlayerId}
            aria-invalid={displayedPlayerError ? true : undefined}
            aria-describedby={displayedPlayerError ? 'provisional-player-error' : undefined}
            onValueChange={(value) => { setSelectedPlayerId(value); setPlayerError(null); if (lockFailure) pickLock.dismissFailure(); }}
            options={[{ value: '', label: 'Choose a player', disabled: true }, ...selectablePlayers.map((player) => ({
              value: player.id,
              label: `${player.name} · ${player.position} ${player.team} · ${RANKING_LABELS.short} #${String(player.ecrRank)}`,
            }))]}
          />
        </label>
        {displayedPlayerError ? (
          <p id="provisional-player-error" className="text-xs font-semibold text-danger" role="alert">
            {displayedPlayerError}
          </p>
        ) : null}

        <label className="block space-y-1.5 text-sm font-semibold">
          <span>Team and draft position</span>
          <Select
            className="w-full"
            aria-label="Team and draft position"
            value={displayedPickNumber}
            onValueChange={(value) => { setSelectedPickNumber(value); setError(null); if (lockFailure) pickLock.dismissFailure(); }}
            options={[{ value: '', label: 'Choose a pick', disabled: true }, ...editablePickNumbers.map((pickNumber) => {
              const teamIndex = order.at(pickNumber).teamIndex;
              return {
                value: String(pickNumber),
                label: `Pick ${order.label(pickNumber)} · #${String(pickNumber)} · ${getTeamName(teamIndex, config.myPickPosition - 1, draftHistory)}`,
              };
            })]}
          />
        </label>

        <div className="rounded-md border border-warning/45 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning">
          {editingPick
            ? 'The corrected entry stays provisional and remains visible for later Reconciliation.'
            : 'The board will label this as a Provisional Pick. The provider\'s picks stay as they are, and it is checked against them when sync returns.'}
        </div>
        {displayedError ? (
          <p className="text-xs font-semibold text-danger" role="alert">
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
          disabled={pending || otherPickInFlight || !canRecord ||
            !displayedPlayerId ||
            !displayedPickNumber ||
            Boolean(
              editingPick &&
              editingPick.playerId === displayedPlayerId &&
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
