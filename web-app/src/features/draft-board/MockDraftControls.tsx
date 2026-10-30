import { asProbability } from '@fantasy-draft/shared/units';
import { STORAGE_ACTIVATION_ENABLED } from '@fantasy-draft/shared/sync';
import { dispatchWorkspace } from '@/workspace/ui-dispatch';
import { useWorkspace, useDraftState } from '@/workspace/WorkspaceProvider';
import { useDraftView } from '@/workspace/useDraftView';
import { type Player } from '@fantasy-draft/shared/league';
import { createSlotSequence } from '@fantasy-draft/shared/draft';
import { type DraftType } from '@fantasy-draft/shared/sync';
import * as React from 'react';
import { useLeagueTimingEvidence } from '@/hooks/useLeagueTimingEvidence';
import { Pause, Play, RotateCcw, Settings2, SkipForward } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { type DraftSessionMode, type MockCpuPickPace } from '@/stores/draftStore';
import { estimateMockSurvivalProbabilities, getKeeperAtPick, type MockDraftEngineConfig } from '@fantasy-draft/shared/draft';
import { useSimulateNextCpuPick } from './mock-auto-advance';

const CPU_PICK_PACE_OPTIONS: readonly { value: MockCpuPickPace; label: string }[] = [
  { value: 'watch', label: 'Watch' },
  { value: 'fast', label: 'Fast' },
  { value: 'instant', label: 'Instant' },
];

function numericValue(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clampBranchPick(currentPick: number, requested: string): number {
  return Math.min(currentPick, numericValue(requested, currentPick));
}

function getNextUserPick(
  currentPick: number,
  myPickPosition: number,
  totalTeams: number,
  totalRounds: number,
  draftType: DraftType
): number | null {
  return createSlotSequence({ type: draftType, teams: totalTeams, rounds: totalRounds })
    .nextForTeam(myPickPosition - 1, currentPick + 1)?.pick ?? null;
}

export function MockDraftControls({
  players,
  isMockReady,
  sessionMode,
}: {
  readonly players: readonly Player[];
  readonly isMockReady: boolean;
  readonly sessionMode: DraftSessionMode;
}): React.ReactElement | null {
  const workspace = useWorkspace();
  const [isOpen, setIsOpen] = React.useState(false);
  const [isEstimating, setIsEstimating] = React.useState(false);
  const [branchPick, setBranchPick] = React.useState('1');
  const draftHistory = useDraftState((state) => state.draftHistory);
  const draftedPlayerIds = useDraftView((view) => view.draftedPlayerIds);
  const preloadedKeepers = useDraftState((state) => state.preloadedKeepers);
  const effectiveKeepers = useDraftView((view) => view.effectiveKeepers);
  const currentPick = useDraftView((view) => view.currentPick);
  const config = useDraftState((state) => state.config);
  const mockSettings = useDraftState((state) => state.mockSettings);
  const isPaused = useDraftState((state) => state.mockAutoAdvance.paused);
  const survivalProbabilities = useDraftState(
    (state) => state.mockSurvivalProbabilities
  );
  const timingEvidence = useLeagueTimingEvidence(sessionMode !== 'live');

  const engineConfig = React.useMemo<MockDraftEngineConfig>(() => ({
    totalTeams: config.totalTeams,
    totalRounds: config.totalRounds,
    myPickPosition: config.myPickPosition,
    draftType: config.draftType,
    rosterRequirements: config.rosterRequirements,
    randomness: mockSettings.randomness,
    seed: mockSettings.seed,
  }), [config, mockSettings.randomness, mockSettings.seed]);

  const simulateNextCpuPick = useSimulateNextCpuPick(players);

  // The settings dialog holds CPU picks; MockDraftAutoAdvance reads this from the store.
  React.useEffect(() => {
    if (STORAGE_ACTIVATION_ENABLED) { dispatchWorkspace(workspace, 'setMockSettingsOpen', isOpen); } else { workspace.send('setMockSettingsOpen', isOpen); }
  }, [workspace, isOpen]);
  React.useEffect(() => () => {
    if (STORAGE_ACTIVATION_ENABLED) { dispatchWorkspace(workspace, 'setMockSettingsOpen', false); } else { workspace.send('setMockSettingsOpen', false); }
  }, [workspace]);

  React.useEffect(() => {
    if (sessionMode !== 'mock' || players.length === 0) return;
    let cancelled = false;
    let timer: number | undefined;
    let completedIterations = 0;
    const survivalCounts: Record<string, number> = {};
    const totalIterations = mockSettings.survivalIterations;
    setIsEstimating(true);
    const runChunk = (): void => {
      const remaining = totalIterations - completedIterations;
      const chunkIterations = Math.min(50, remaining);
      if (chunkIterations <= 0) {
        const probabilities = Object.fromEntries(
          Object.entries(survivalCounts).map(([playerId, count]) => [
            playerId,
            asProbability(count / totalIterations),
          ])
        );
        if (!cancelled) {
          if (STORAGE_ACTIVATION_ENABLED) { dispatchWorkspace(workspace, 'setMockSurvivalProbabilities', probabilities); } else { workspace.send('setMockSurvivalProbabilities', probabilities); }
          setIsEstimating(false);
        }
        return;
      }
      const probabilities = estimateMockSurvivalProbabilities({
        players,
        draftedPlayerIds,
        history: draftHistory,
        keepers: effectiveKeepers,
        currentPick,
        config: engineConfig,
        historyModel: timingEvidence.model,
        iterations: chunkIterations,
        iterationOffset: completedIterations,
      });
      for (const [playerId, probability] of Object.entries(probabilities)) {
        survivalCounts[playerId] = (survivalCounts[playerId] ?? 0) +
          probability * chunkIterations;
      }
      completedIterations += chunkIterations;
      if (!cancelled) timer = window.setTimeout(runChunk, 0);
    };
    timer = window.setTimeout(runChunk, 0);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [
    workspace,
    currentPick,
    draftHistory,
    draftedPlayerIds,
    engineConfig,
    timingEvidence.model,
    mockSettings.survivalIterations,
    players,
    effectiveKeepers,
    sessionMode,
  ]);

  React.useEffect(() => {
    setBranchPick(String(currentPick));
  }, [currentPick]);

  const isMyTurn = useDraftView((view) => view.isMyTurn);
  if (sessionMode === 'live') return null;

  const totalPicks = config.totalTeams * config.totalRounds;
  const keeperAtCurrentPick = getKeeperAtPick(
    effectiveKeepers,
    currentPick,
    config.totalTeams,
    config.draftType
  );
  const nextUserPick = getNextUserPick(
    currentPick,
    config.myPickPosition,
    config.totalTeams,
    config.totalRounds,
    config.draftType
  );
  const survivalLeaders = players
    .filter((player) => !draftedPlayerIds.has(player.id))
    .sort((left, right) => left.ecrRank - right.ecrRank)
    .slice(0, 6);
  const draftStarted = draftHistory.length > 0;
  const minimumMockTeams = Math.max(
    2,
    ...preloadedKeepers.map((keeper) => keeper.teamIndex + 1)
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {sessionMode === 'mock' ? (
        <>
          <Button
            variant={isPaused ? 'default' : 'outline'}
            size="sm"
            className="text-xs"
            onClick={() => { if (STORAGE_ACTIVATION_ENABLED) { dispatchWorkspace(workspace, 'setMockAutoAdvancePaused', !isPaused); } else { workspace.send('setMockAutoAdvancePaused', !isPaused); } }}
            disabled={currentPick > totalPicks}
          >
            {isPaused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
            {isPaused ? 'Resume' : 'Pause'}
          </Button>
          {isPaused ? (
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => {
                const result = simulateNextCpuPick();
                if (result instanceof Promise) void result.catch(() => undefined);
              }}
              disabled={(isMyTurn && !keeperAtCurrentPick) || currentPick > totalPicks}
            >
              <SkipForward className="size-3.5" />
              CPU pick
            </Button>
          ) : null}
        </>
      ) : null}
      <Button
        variant="outline"
        size="sm"
        onClick={() => { setIsOpen(true); }}
        disabled={sessionMode === 'setup' && !isMockReady}
        title={isMockReady ? undefined : 'Confirm and resolve every keeper before starting a mock'}
        className="text-xs"
      >
        {sessionMode === 'mock' ? <Settings2 className="size-3.5" /> : <Play className="size-3.5" />}
        {sessionMode === 'mock' ? 'Settings' : 'Start mock'}
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {sessionMode === 'mock' ? 'Mock draft controls' : 'Start a mock draft'}
            </DialogTitle>
            <DialogDescription>
              CPU teams draft from market price and room history. Suggestions stay focused on your roster and pick value.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <label className="space-y-1 text-xs text-muted-foreground">
              League teams
              <Input
                type="number"
                min={minimumMockTeams}
                max={16}
                value={config.totalTeams}
                disabled={draftStarted}
                onChange={(event) => {
                  if (STORAGE_ACTIVATION_ENABLED) { dispatchWorkspace(workspace, 'setConfig', {
                    totalTeams: Math.max(
                      minimumMockTeams,
                      numericValue(event.target.value, config.totalTeams)
                    ),
                  }); } else { workspace.send('setConfig', {
                    totalTeams: Math.max(
                      minimumMockTeams,
                      numericValue(event.target.value, config.totalTeams)
                    ),
                  }); }
                }}
                className="h-9"
              />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              Your draft slot
              <Input
                type="number"
                min={1}
                max={config.totalTeams}
                value={config.myPickPosition}
                disabled={draftStarted}
                onChange={(event) => {
                  if (STORAGE_ACTIVATION_ENABLED) { dispatchWorkspace(workspace, 'setConfig', {
                    myPickPosition: numericValue(event.target.value, config.myPickPosition),
                  }); } else { workspace.send('setConfig', {
                    myPickPosition: numericValue(event.target.value, config.myPickPosition),
                  }); }
                }}
                className="h-9"
              />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              Randomness · {String(Math.round(mockSettings.randomness * 100))}%
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(mockSettings.randomness * 100)}
                onChange={(event) => {
                  if (STORAGE_ACTIVATION_ENABLED) { dispatchWorkspace(workspace, 'setMockSettings', {
                    randomness: Number(event.target.value) / 100,
                  }); } else { workspace.send('setMockSettings', {
                    randomness: Number(event.target.value) / 100,
                  }); }
                }}
                className="h-9 w-full accent-primary"
              />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              Draft seed
              <Input
                type="number"
                min={0}
                value={mockSettings.seed}
                onChange={(event) => {
                  if (STORAGE_ACTIVATION_ENABLED) { dispatchWorkspace(workspace, 'setMockSettings', {
                    seed: numericValue(event.target.value, mockSettings.seed),
                  }); } else { workspace.send('setMockSettings', {
                    seed: numericValue(event.target.value, mockSettings.seed),
                  }); }
                }}
                className="h-9"
              />
            </label>
            <div className="space-y-1 text-xs text-muted-foreground">
              Alternate room
              <Button
                variant="outline"
                size="sm"
                className="h-9 w-full text-xs"
                onClick={() => {
                  if (STORAGE_ACTIVATION_ENABLED) { dispatchWorkspace(workspace, 'setMockSettings', {
                    seed: Math.floor(Date.now() % 2147483647),
                  }); } else { workspace.send('setMockSettings', {
                    seed: Math.floor(Date.now() % 2147483647),
                  }); }
                }}
              >
                New seed
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="mr-1">CPU pick speed</span>
            {CPU_PICK_PACE_OPTIONS.map((option) => (
              <Button
                key={option.value}
                variant={mockSettings.cpuPickPace === option.value ? 'default' : 'outline'}
                size="sm"
                className="h-8 text-xs"
                aria-pressed={mockSettings.cpuPickPace === option.value}
                onClick={() => {
                  if (STORAGE_ACTIVATION_ENABLED) { dispatchWorkspace(workspace, 'setMockSettings', { cpuPickPace: option.value }); } else { workspace.send('setMockSettings', { cpuPickPace: option.value }); }
                }}
              >
                {option.label}
              </Button>
            ))}
            <span className="ml-auto">CPU teams pick automatically and stop at your selection.</span>
          </div>

          {sessionMode === 'mock' ? (
            <>
              <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                <div className="mr-auto text-xs text-muted-foreground">
                  {currentPick > totalPicks
                    ? 'Draft complete'
                    : `${isMyTurn && !keeperAtCurrentPick ? 'Your selection' : 'CPU selection'} · ${createSlotSequence({ type: config.draftType, teams: config.totalTeams, rounds: config.totalRounds }).label(currentPick)} · overall #${String(currentPick)}`}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (STORAGE_ACTIVATION_ENABLED) { dispatchWorkspace(workspace, 'undoLastPick'); } else { workspace.send('undoLastPick'); }
                  }}
                  disabled={draftHistory.length === 0}
                >
                  Undo
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (STORAGE_ACTIVATION_ENABLED) { dispatchWorkspace(workspace, 'resetDraft'); } else { workspace.send('resetDraft'); }
                  }}
                >
                  <RotateCcw className="size-3.5" /> Restart
                </Button>
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <label className="space-y-1 text-xs text-muted-foreground">
                  Branch at overall pick
                  <Input
                    type="number"
                    min={1}
                    max={currentPick}
                    value={branchPick}
                    onChange={(event) => { setBranchPick(event.target.value); }}
                    className="h-9 w-28"
                  />
                </label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const pick = clampBranchPick(currentPick, branchPick);
                    if (STORAGE_ACTIVATION_ENABLED) { dispatchWorkspace(workspace, 'branchFromPick', pick); } else { workspace.send('branchFromPick', pick); }
                  }}
                >
                  Create branch
                </Button>
              </div>

              <div className="border-t pt-4">
                <div className="mb-2 flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold">
                    Survival to {nextUserPick ? createSlotSequence({ type: config.draftType, teams: config.totalTeams, rounds: config.totalRounds }).label(nextUserPick) : 'draft end'}
                  </span>
                  <span className="text-muted-foreground">
                    {isEstimating ? 'Running room simulations…' : `${String(mockSettings.survivalIterations)} simulations`}
                  </span>
                </div>
                <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                  {survivalLeaders.map((player) => (
                    <div
                      key={player.id}
                      className="flex items-center justify-between gap-2 rounded border bg-muted/25 px-2 py-1.5 text-xs"
                    >
                      <span className="truncate">{player.name}</span>
                      <span className="font-mono tabular-nums">
                        {survivalProbabilities[player.id] === undefined
                          ? '—'
                          : `${String(Math.round((survivalProbabilities[player.id] ?? 0) * 100))}%`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <p className="rounded-lg bg-muted/35 p-3 text-xs leading-relaxed text-muted-foreground">
              Keepers appear in their assigned board slots. Team count and draft slot lock after the first selection.
            </p>
          )}

          <DialogFooter className="border-t pt-4">
            {sessionMode === 'mock' ? (
              <>
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (STORAGE_ACTIVATION_ENABLED) { dispatchWorkspace(workspace, 'resetDraft'); } else { workspace.send('resetDraft'); }
                    if (STORAGE_ACTIVATION_ENABLED) { dispatchWorkspace(workspace, 'setSessionMode', 'setup'); } else { workspace.send('setSessionMode', 'setup'); }
                    setIsOpen(false);
                  }}
                >
                  Exit mock
                </Button>
                <Button onClick={() => { setIsOpen(false); }}>Return to board</Button>
              </>
            ) : (
              <Button
                onClick={() => {
                  if (STORAGE_ACTIVATION_ENABLED) { dispatchWorkspace(workspace, 'setSessionMode', 'mock'); } else { workspace.send('setSessionMode', 'mock'); }
                  setIsOpen(false);
                }}
                disabled={!isMockReady}
              >
                Start mock draft
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
