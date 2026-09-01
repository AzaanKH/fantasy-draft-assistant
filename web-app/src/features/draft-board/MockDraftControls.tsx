import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { POSITIONS, type Player, type Position } from '@fantasy-draft/shared';
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
import {
  calculateIsMyTurn,
  useDraftStore,
  useDraftStoreApi,
  type DraftSessionMode,
} from '@/stores/draftStore';
import {
  estimateMockSurvivalProbabilities,
  formatRoundPick,
  getKeeperAtPick,
  getTeamIndexForPick,
  selectCpuPlayer,
  type MockDraftEngineConfig,
  type MockLeagueHistoryModel,
} from '@/lib/mock-draft-engine';

const CHUNK_BUDGET_MS = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isMockManagerPositionTendency(value: unknown): boolean {
  return (
    isRecord(value) &&
    isFiniteNumber(value['picks']) &&
    isFiniteNumber(value['pickRate']) &&
    isFiniteNumber(value['earlyPickRate']) &&
    (
      value['leaguePickRateDelta'] === undefined ||
      isFiniteNumber(value['leaguePickRateDelta'])
    )
  );
}

function isMockManagerTendency(value: unknown): boolean {
  if (
    !isRecord(value) ||
    typeof value['managerKey'] !== 'string' ||
    !Array.isArray(value['draftSlots']) ||
    !value['draftSlots'].every((slot) => isFiniteNumber(slot) && Number.isInteger(slot)) ||
    !isFiniteNumber(value['sampleSize']) ||
    !isRecord(value['positions'])
  ) {
    return false;
  }
  const positions = value['positions'];
  return POSITIONS.every((position) =>
    isMockManagerPositionTendency(positions[position])
  );
}

function isMockPositionHistory(value: unknown): boolean {
  return (
    isRecord(value) &&
    (
      isFiniteNumber(value['top50RateDelta']) ||
      isFiniteNumber(value['top100RateDelta'])
    ) &&
    (
      value['top50RateDelta'] === undefined ||
      isFiniteNumber(value['top50RateDelta'])
    ) &&
    (
      value['top100RateDelta'] === undefined ||
      isFiniteNumber(value['top100RateDelta'])
    )
  );
}

function isMockHistoryModel(value: unknown): value is MockLeagueHistoryModel {
  if (!isRecord(value)) return false;
  if (!isRecord(value['positions'])) return false;
  const positions = value['positions'];
  if (!POSITIONS.every((position: Position) =>
    isMockPositionHistory(positions[position])
  )) {
    return false;
  }
  return value['managerTendencies'] === undefined || (
    Array.isArray(value['managerTendencies']) &&
    value['managerTendencies'].every(isMockManagerTendency)
  );
}

async function fetchMockHistoryModel(): Promise<MockLeagueHistoryModel | null> {
  const response = await fetch('/data/league-history/survival-model.json');
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Failed to load league draft history: ${String(response.status)}`);
  }
  const parsed: unknown = await response.json();
  return isMockHistoryModel(parsed) ? parsed : null;
}

function numericValue(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getNextUserPick(
  currentPick: number,
  myPickPosition: number,
  totalTeams: number,
  totalRounds: number
): number | null {
  const totalPicks = totalTeams * totalRounds;
  for (let pickNumber = currentPick + 1; pickNumber <= totalPicks; pickNumber += 1) {
    if (getTeamIndexForPick(pickNumber, totalTeams) === myPickPosition - 1) {
      return pickNumber;
    }
  }
  return null;
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
  const draftStore = useDraftStoreApi();
  const [isOpen, setIsOpen] = React.useState(false);
  const [isRunning, setIsRunning] = React.useState(false);
  const [isEstimating, setIsEstimating] = React.useState(false);
  const [branchPick, setBranchPick] = React.useState('1');
  const draftHistory = useDraftStore((state) => state.draftHistory);
  const draftedPlayerIds = useDraftStore((state) => state.draftedPlayerIds);
  const preloadedKeepers = useDraftStore((state) => state.preloadedKeepers);
  const currentPick = useDraftStore((state) => state.currentPick);
  const config = useDraftStore((state) => state.config);
  const mockSettings = useDraftStore((state) => state.mockSettings);
  const survivalProbabilities = useDraftStore(
    (state) => state.mockSurvivalProbabilities
  );
  const historyQuery = useQuery({
    queryKey: ['league-survival-model'],
    queryFn: fetchMockHistoryModel,
    staleTime: Infinity,
  });

  const engineConfig = React.useMemo<MockDraftEngineConfig>(() => ({
    totalTeams: config.totalTeams,
    totalRounds: config.totalRounds,
    myPickPosition: config.myPickPosition,
    rosterRequirements: config.rosterRequirements,
    randomness: mockSettings.randomness,
    seed: mockSettings.seed,
  }), [config, mockSettings.randomness, mockSettings.seed]);

  const simulateNextCpuPick = React.useCallback((): boolean => {
    const state = draftStore.getState();
    const totalPicks = state.config.totalTeams * state.config.totalRounds;
    if (state.currentPick > totalPicks) return false;

    const keeper = getKeeperAtPick(
      state.preloadedKeepers,
      state.currentPick,
      state.config.totalTeams
    );
    if (keeper) {
      state.consumeKeeperAtCurrentPick();
      return true;
    }

    if (calculateIsMyTurn(
      state.currentPick,
      state.config.myPickPosition,
      state.config.totalTeams
    )) {
      return false;
    }

    const selection = selectCpuPlayer({
      players,
      draftedPlayerIds: state.draftedPlayerIds,
      history: state.draftHistory,
      keepers: state.preloadedKeepers,
      currentPick: state.currentPick,
      config: {
        totalTeams: state.config.totalTeams,
        totalRounds: state.config.totalRounds,
        myPickPosition: state.config.myPickPosition,
        rosterRequirements: state.config.rosterRequirements,
        randomness: state.mockSettings.randomness,
        seed: state.mockSettings.seed,
      },
      historyModel: historyQuery.data,
    });
    if (!selection) return false;

    const teamIndex = getTeamIndexForPick(state.currentPick, state.config.totalTeams);
    state.markPlayerDrafted(
      selection.player.id,
      selection.player.name,
      selection.player.position,
      teamIndex,
      `Team ${String(teamIndex + 1)}`,
      undefined,
      'cpu',
      selection.player.team
    );
    return true;
  }, [draftStore, historyQuery.data, players]);

  React.useEffect(() => {
    if (sessionMode !== 'mock') return;
    const keeper = getKeeperAtPick(preloadedKeepers, currentPick, config.totalTeams);
    if (keeper) {
      draftStore.getState().consumeKeeperAtCurrentPick();
    }
  }, [config.totalTeams, currentPick, draftStore, preloadedKeepers, sessionMode]);

  React.useEffect(() => {
    if (!isRunning || sessionMode !== 'mock') return;
    const timer = window.setTimeout(() => {
      const state = draftStore.getState();
      const keeper = getKeeperAtPick(
        state.preloadedKeepers,
        state.currentPick,
        state.config.totalTeams
      );
      if (!keeper && calculateIsMyTurn(
        state.currentPick,
        state.config.myPickPosition,
        state.config.totalTeams
      )) {
        setIsRunning(false);
        return;
      }
      if (!simulateNextCpuPick()) setIsRunning(false);
    }, 120);
    return () => { window.clearTimeout(timer); };
  }, [currentPick, draftStore, isRunning, sessionMode, simulateNextCpuPick]);

  React.useEffect(() => {
    if (sessionMode !== 'mock' || players.length === 0) return;
    let cancelled = false;
    let timer: number | undefined;
    let completedIterations = 0;
    const survivalCounts: Record<string, number> = {};
    const totalIterations = mockSettings.survivalIterations;
    let nextChunkIterations = Math.min(10, totalIterations);
    setIsEstimating(true);
    const runChunk = (): void => {
      const remaining = totalIterations - completedIterations;
      const chunkIterations = Math.min(nextChunkIterations, remaining);
      if (chunkIterations <= 0) {
        const probabilities = Object.fromEntries(
          Object.entries(survivalCounts).map(([playerId, count]) => [
            playerId,
            count / totalIterations,
          ])
        );
        if (!cancelled) {
          draftStore.getState().setMockSurvivalProbabilities(probabilities);
          setIsEstimating(false);
        }
        return;
      }
      const chunkStartedAt = performance.now();
      const probabilities = estimateMockSurvivalProbabilities({
        players,
        draftedPlayerIds,
        history: draftHistory,
        keepers: preloadedKeepers,
        currentPick,
        config: engineConfig,
        historyModel: historyQuery.data,
        iterations: chunkIterations,
        iterationOffset: completedIterations,
      });
      for (const [playerId, probability] of Object.entries(probabilities)) {
        survivalCounts[playerId] = (survivalCounts[playerId] ?? 0) +
          probability * chunkIterations;
      }
      completedIterations += chunkIterations;
      const elapsedMs = Math.max(0.1, performance.now() - chunkStartedAt);
      const targetChunkIterations = chunkIterations * CHUNK_BUDGET_MS / elapsedMs;
      nextChunkIterations = Math.max(
        1,
        Math.round((chunkIterations + targetChunkIterations) / 2)
      );
      if (!cancelled) timer = window.setTimeout(runChunk, 0);
    };
    timer = window.setTimeout(runChunk, 0);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [
    currentPick,
    draftHistory,
    draftedPlayerIds,
    draftStore,
    engineConfig,
    historyQuery.data,
    mockSettings.survivalIterations,
    players,
    preloadedKeepers,
    sessionMode,
  ]);

  React.useEffect(() => {
    setBranchPick(String(currentPick));
  }, [currentPick]);

  if (sessionMode === 'live') return null;

  const totalPicks = config.totalTeams * config.totalRounds;
  const isMyTurn = calculateIsMyTurn(
    currentPick,
    config.myPickPosition,
    config.totalTeams
  );
  const keeperAtCurrentPick = getKeeperAtPick(
    preloadedKeepers,
    currentPick,
    config.totalTeams
  );
  const nextUserPick = getNextUserPick(
    currentPick,
    config.myPickPosition,
    config.totalTeams,
    config.totalRounds
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
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => { simulateNextCpuPick(); }}
            disabled={(isMyTurn && !keeperAtCurrentPick) || currentPick > totalPicks}
          >
            <SkipForward className="size-3.5" />
            CPU pick
          </Button>
          <Button
            variant={isRunning ? 'destructive' : 'default'}
            size="sm"
            className="text-xs"
            onClick={() => { setIsRunning((running) => !running); }}
            disabled={(isMyTurn && !keeperAtCurrentPick) || currentPick > totalPicks}
          >
            {isRunning ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            {isRunning ? 'Pause' : 'To my pick'}
          </Button>
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
                  draftStore.getState().setConfig({
                    totalTeams: Math.max(
                      minimumMockTeams,
                      numericValue(event.target.value, config.totalTeams)
                    ),
                  });
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
                  draftStore.getState().setConfig({
                    myPickPosition: numericValue(event.target.value, config.myPickPosition),
                  });
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
                  draftStore.getState().setMockSettings({
                    randomness: Number(event.target.value) / 100,
                  });
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
                  draftStore.getState().setMockSettings({
                    seed: numericValue(event.target.value, mockSettings.seed),
                  });
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
                  draftStore.getState().setMockSettings({
                    seed: Math.floor(Date.now() % 2147483647),
                  });
                }}
              >
                New seed
              </Button>
            </div>
          </div>

          {sessionMode === 'mock' ? (
            <>
              <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                <div className="mr-auto text-xs text-muted-foreground">
                  {currentPick > totalPicks
                    ? 'Draft complete'
                    : `${isMyTurn && !keeperAtCurrentPick ? 'Your selection' : 'CPU selection'} · ${formatRoundPick(currentPick, config.totalTeams)} · overall #${String(currentPick)}`}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setIsRunning(false);
                    draftStore.getState().undoLastPick();
                  }}
                  disabled={draftHistory.length === 0}
                >
                  Undo
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setIsRunning(false);
                    draftStore.getState().resetDraft();
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
                    max={totalPicks + 1}
                    value={branchPick}
                    onChange={(event) => { setBranchPick(event.target.value); }}
                    className="h-9 w-28"
                  />
                </label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setIsRunning(false);
                    draftStore.getState().branchFromPick(numericValue(branchPick, currentPick));
                  }}
                >
                  Create branch
                </Button>
              </div>

              <div className="border-t pt-4">
                <div className="mb-2 flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold">
                    Survival to {nextUserPick ? formatRoundPick(nextUserPick, config.totalTeams) : 'draft end'}
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
                    setIsRunning(false);
                    draftStore.getState().resetDraft();
                    draftStore.getState().setSessionMode('setup');
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
                  draftStore.getState().setSessionMode('mock');
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
