import * as React from 'react';
import type { Player, Position } from '@fantasy-draft/shared';
import { Focus, Grid3X3 } from 'lucide-react';
import { PlayerHeadshot } from '@/components/PlayerHeadshot';
import { isMotionDisabled } from '@/components/motion';
import { Badge } from '@/components/ui/badge';
import { usePlayerDataQuery } from '@/hooks/usePlayerData';
import {
  formatRoundPick,
  getPickNumberForTeamRound,
} from '@/lib/mock-draft-engine';
import { getEffectiveKeeperAssignments } from '@/lib/keeper-supply';
import { cn } from '@/lib/utils';
import { useDraftStore, type RecordedDraftPick } from '@/stores/draftStore';
import { getDraftBoardScrollTarget } from './draft-board-scroll';
import { getDraftBoardCurrentView } from './draft-board-view';

const STICKY_HEADER_HEIGHT = 48;
const STICKY_ROUND_COLUMN_WIDTH = 56;
const MOBILE_ROUND_COLUMN_WIDTH = 44;
const TEAM_COLUMN_MIN_WIDTH = 116;

const positionSurface: Record<Position, string> = {
  QB: 'border-red-500/35 bg-red-500/15',
  RB: 'border-emerald-500/35 bg-emerald-500/15',
  WR: 'border-sky-500/35 bg-sky-500/15',
  TE: 'border-orange-500/35 bg-orange-500/15',
  K: 'border-violet-500/35 bg-violet-500/15',
  DEF: 'border-slate-500/35 bg-slate-500/15',
};

interface BoardPick {
  readonly playerId: string;
  readonly playerName: string;
  readonly position: Position;
  readonly pickNumber: number;
  readonly source: RecordedDraftPick['source'] | 'reserved';
}

type BoardMode = 'current' | 'full';

function getTeamNames(
  picks: readonly RecordedDraftPick[],
  totalTeams: number,
  myTeamIndex: number
): string[] {
  const names = Array.from({ length: totalTeams }, (_, teamIndex) =>
    teamIndex === myTeamIndex ? 'My Team' : `Team ${String(teamIndex + 1)}`
  );
  for (const pick of picks) {
    if (pick.teamIndex >= 0 && pick.teamIndex < totalTeams) {
      names[pick.teamIndex] = pick.teamIndex === myTeamIndex ? 'My Team' : pick.teamName;
    }
  }
  return names;
}

function EmptyPick({
  pickNumber,
  totalTeams,
  currentPick,
  isActive,
  isUpcoming,
  isMyTeam,
  compact,
}: {
  readonly pickNumber: number;
  readonly totalTeams: number;
  readonly currentPick: number;
  readonly isActive: boolean;
  readonly isUpcoming: boolean;
  readonly isMyTeam: boolean;
  readonly compact: boolean;
}): React.ReactElement {
  const status = isActive
    ? 'On the clock'
    : isUpcoming && isMyTeam
      ? 'Your pick'
      : isUpcoming
        ? `In ${String(pickNumber - currentPick)}`
        : 'Open';

  return (
    <div className={cn('flex h-full min-w-0 flex-col justify-between overflow-hidden', compact ? 'p-1.5' : 'p-2')}>
      <span className="self-end font-mono text-[10px] text-muted-foreground/70">
        {formatRoundPick(pickNumber, totalTeams)}
      </span>
      <span className={cn(
        'max-w-full truncate whitespace-nowrap font-semibold uppercase leading-none tracking-[0.1em] text-muted-foreground/50',
        compact ? 'text-[8px]' : 'text-[10px]',
        isUpcoming && 'text-sky-700 dark:text-sky-300',
        (isActive || isMyTeam) && 'text-emerald-700 dark:text-emerald-300'
      )}>
        {status}
      </span>
    </div>
  );
}

function FilledPick({
  pick,
  player,
  isSettling,
  compact,
}: {
  readonly pick: BoardPick;
  readonly player?: Player;
  readonly isSettling: boolean;
  readonly compact: boolean;
}): React.ReactElement {
  return (
    <div
      className={cn(
        'relative h-full overflow-hidden border',
        compact ? 'p-1.5' : 'p-2',
        positionSurface[pick.position],
        pick.source === 'provisional' &&
          'border-amber-500/70 bg-amber-500/10 ring-1 ring-inset ring-amber-500/45',
        isSettling && 'draft-pick-confirmed'
      )}
    >
      <div
        data-pick-identity
        className={cn('relative z-10 min-w-0', !compact && 'max-w-[calc(100%-38px)]')}
      >
        <div className={cn('truncate font-bold leading-tight', compact ? 'text-[11px]' : 'text-xs')}>
          {pick.playerName}
        </div>
        <div className={cn(
          'truncate whitespace-nowrap leading-tight text-muted-foreground',
          compact ? 'mt-0.5 text-[9px]' : 'mt-1 text-[10px]'
        )}>
          <span className="font-mono">#{String(pick.pickNumber)}</span>
          <span> · {pick.position}</span>
          {player?.team ? <span> · {player.team}</span> : null}
          {pick.source === 'reserved' ? <span> · Keeper</span> : null}
        </div>
        {pick.source === 'provisional' ? (
          <div className={cn(
            'inline-flex rounded border border-amber-500/55 bg-background/80 font-bold uppercase leading-none tracking-[0.08em] text-amber-800 dark:text-amber-200',
            compact ? 'mt-0.5 px-0.5 py-0.5 text-[6px]' : 'mt-1 px-1 py-0.5 text-[8px]'
          )}>
            Provisional Pick
          </div>
        ) : null}
      </div>
      {!compact ? (
        <span data-pick-identity className="absolute -bottom-1 -right-1 size-14">
          <PlayerHeadshot
            playerId={pick.playerId}
            name={pick.playerName}
            position={pick.position}
            className="size-full rounded-tl-2xl opacity-85"
            imageClassName="object-top"
          />
        </span>
      ) : null}
    </div>
  );
}

interface DraftGridProps {
  readonly activeRound: number | null;
  readonly activeTeamIndex: number;
  readonly activeSlotRef: React.RefObject<HTMLDivElement>;
  readonly boardRef: React.RefObject<HTMLDivElement>;
  readonly compact: boolean;
  readonly currentPick: number;
  readonly currentPickMode: boolean;
  readonly latestPickNumber: number;
  readonly settlingPickNumber: number | null;
  readonly myTeamIndex: number;
  readonly picksByNumber: ReadonlyMap<number, BoardPick>;
  readonly playersById: ReadonlyMap<string, Player>;
  readonly roundNumbers: readonly number[];
  readonly teamIndices: readonly number[];
  readonly teamNames: readonly string[];
  readonly totalPicks: number;
  readonly totalTeams: number;
  readonly upcomingMyPickNumber: number | null;
  readonly wrapperClassName?: string;
}

function DraftGrid({
  activeRound,
  activeTeamIndex,
  activeSlotRef,
  boardRef,
  compact,
  currentPick,
  currentPickMode,
  latestPickNumber,
  settlingPickNumber,
  myTeamIndex,
  picksByNumber,
  playersById,
  roundNumbers,
  teamIndices,
  teamNames,
  totalPicks,
  totalTeams,
  upcomingMyPickNumber,
  wrapperClassName,
}: DraftGridProps): React.ReactElement {
  const roundColumnWidth = compact
    ? MOBILE_ROUND_COLUMN_WIDTH
    : STICKY_ROUND_COLUMN_WIDTH;
  const gridStyle: React.CSSProperties = {
    gridTemplateColumns: compact
      ? `${String(roundColumnWidth)}px repeat(${String(teamIndices.length)}, minmax(0, 1fr))`
      : `${String(roundColumnWidth)}px repeat(${String(teamIndices.length)}, minmax(${String(TEAM_COLUMN_MIN_WIDTH)}px, 1fr))`,
    minWidth: compact
      ? '100%'
      : `${String(roundColumnWidth + teamIndices.length * TEAM_COLUMN_MIN_WIDTH)}px`,
  };

  return (
    <div
      ref={boardRef}
      data-round-column-width={roundColumnWidth}
      className={cn(
        'h-[clamp(380px,57vh,650px)] overflow-auto bg-muted/10',
        wrapperClassName
      )}
    >
      <div className="grid w-full gap-px bg-border/70" style={gridStyle}>
        <div className="sticky left-0 top-0 z-30 flex h-12 items-center justify-center bg-card text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Round
        </div>
        {teamIndices.map((teamIndex) => {
          const isMyTeam = teamIndex === myTeamIndex;
          const isActiveTeam = currentPick <= totalPicks && teamIndex === activeTeamIndex;
          return (
            <div
              key={`team-${String(teamIndex)}`}
              className={cn(
                'sticky top-0 z-20 flex h-12 items-center justify-center overflow-hidden bg-card px-1.5 text-center text-xs font-semibold transition-[background-color,color,opacity]',
                isMyTeam && 'text-emerald-700 dark:text-emerald-300',
                currentPickMode && isMyTeam && 'bg-emerald-500/15 shadow-[inset_2px_0_0_rgb(16_185_129_/_0.55),inset_-2px_0_0_rgb(16_185_129_/_0.55)]',
                currentPickMode && isActiveTeam && !isMyTeam && 'text-foreground shadow-[inset_0_-3px_0_rgb(14_165_233_/_0.8)]',
                currentPickMode && !isMyTeam && !isActiveTeam && 'opacity-55'
              )}
            >
              {!currentPickMode && isMyTeam ? (
                <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-emerald-500/10" />
              ) : null}
              <span className="relative z-10 truncate">{teamNames[teamIndex]}</span>
            </div>
          );
        })}

        {roundNumbers.map((roundNumber) => {
          const isActiveRound = activeRound === roundNumber;
          return (
            <React.Fragment key={`round-${String(roundNumber)}`}>
              <div
                className={cn(
                  'sticky left-0 z-10 flex h-20 flex-col items-center justify-center bg-card font-mono text-xs font-semibold text-muted-foreground transition-[background-color,color,opacity]',
                  currentPickMode && isActiveRound && 'bg-emerald-500/15 text-emerald-800 shadow-[inset_3px_0_0_rgb(16_185_129)] dark:text-emerald-200',
                  currentPickMode && !isActiveRound && 'opacity-55'
                )}
                aria-current={isActiveRound ? 'step' : undefined}
              >
                <span>R{String(roundNumber)}</span>
                {currentPickMode && isActiveRound ? (
                  <span className="mt-1 font-sans text-[8px] font-bold uppercase tracking-[0.12em]">Now</span>
                ) : null}
              </div>
              {teamIndices.map((teamIndex) => {
                const pickNumber = getPickNumberForTeamRound(
                  teamIndex,
                  roundNumber,
                  totalTeams
                );
                const pick = picksByNumber.get(pickNumber);
                const isActive = currentPick === pickNumber && currentPick <= totalPicks;
                const isMyTeam = teamIndex === myTeamIndex;
                const isLatest = latestPickNumber > 0 && pickNumber === latestPickNumber;
                const isUpcoming = upcomingMyPickNumber !== null &&
                  pickNumber >= currentPick &&
                  pickNumber <= upcomingMyPickNumber;
                const isFocusContext = isActiveRound || isMyTeam || isLatest || isUpcoming;
                return (
                  <div
                    key={`pick-${String(pickNumber)}`}
                    ref={isActive ? activeSlotRef : undefined}
                    className={cn(
                      'h-20 overflow-hidden bg-card/95 outline-none transition-[background-color,box-shadow,filter,opacity]',
                      !currentPickMode && isMyTeam && 'bg-emerald-500/[0.035]',
                      currentPickMode && isActiveRound && 'border-y border-sky-500/25',
                      currentPickMode && isMyTeam && 'bg-emerald-500/[0.09] shadow-[inset_2px_0_0_rgb(16_185_129_/_0.4),inset_-2px_0_0_rgb(16_185_129_/_0.4)]',
                      currentPickMode && isUpcoming && 'bg-sky-500/[0.07] ring-1 ring-inset ring-sky-400/50',
                      currentPickMode && !isFocusContext && 'opacity-50 grayscale-[0.3]',
                      isActive && 'relative z-[11] ring-2 ring-inset ring-emerald-500'
                    )}
                    aria-label={`Pick ${formatRoundPick(pickNumber, totalTeams)}${pick ? `, ${pick.playerName}${pick.source === 'provisional' ? ', Provisional Pick' : ''}${isLatest ? ', latest pick' : ''}` : ''}${isActive ? ', on the clock' : ''}${isMyTeam ? ', My Team' : ''}${isUpcoming ? ', in the upcoming selection window' : ''}`}
                  >
                    {pick ? (
                      <FilledPick
                        pick={pick}
                        player={playersById.get(pick.playerId)}
                        isSettling={pickNumber === settlingPickNumber}
                        compact={compact}
                      />
                    ) : (
                      <EmptyPick
                        pickNumber={pickNumber}
                        totalTeams={totalTeams}
                        currentPick={currentPick}
                        isActive={isActive}
                        isUpcoming={isUpcoming}
                        isMyTeam={isMyTeam}
                        compact={compact}
                      />
                    )}
                  </div>
                );
              })}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

function BoardModeButton({
  active,
  children,
  onClick,
}: {
  readonly active: boolean;
  readonly children: React.ReactNode;
  readonly onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-semibold outline-none transition-[background-color,color,box-shadow] focus-visible:ring-2 focus-visible:ring-ring/60',
        active
          ? 'bg-card text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {children}
    </button>
  );
}

export function getDraftBoardRoundNumbers(
  totalRounds: number,
  activeRound: number | null,
  windowSize?: number
): number[] {
  const normalizedRounds = Math.max(1, Math.round(totalRounds));
  if (windowSize === undefined || windowSize >= normalizedRounds) {
    return Array.from({ length: normalizedRounds }, (_, index) => index + 1);
  }

  const normalizedWindow = Math.max(1, Math.round(windowSize));
  const centerRound = Math.min(
    normalizedRounds,
    Math.max(1, activeRound ?? 1)
  );
  const start = Math.min(
    normalizedRounds - normalizedWindow + 1,
    Math.max(1, centerRound - Math.floor(normalizedWindow / 2))
  );
  return Array.from({ length: normalizedWindow }, (_, index) => start + index);
}

export function DraftBoard({
  roundWindowSize,
}: {
  readonly roundWindowSize?: number;
} = {}): React.ReactElement {
  const { players } = usePlayerDataQuery();
  const config = useDraftStore((state) => state.config);
  const currentPick = useDraftStore((state) => state.currentPick);
  const draftHistory = useDraftStore((state) => state.draftHistory);
  const preloadedKeepers = useDraftStore((state) => state.preloadedKeepers);
  const [mode, setMode] = React.useState<BoardMode>('current');
  const [settlingPickNumber, setSettlingPickNumber] = React.useState<number | null>(null);
  const currentDesktopBoardRef = React.useRef<HTMLDivElement>(null);
  const currentDesktopSlotRef = React.useRef<HTMLDivElement>(null);
  const currentMobileBoardRef = React.useRef<HTMLDivElement>(null);
  const currentMobileSlotRef = React.useRef<HTMLDivElement>(null);
  const fullBoardRef = React.useRef<HTMLDivElement>(null);
  const fullSlotRef = React.useRef<HTMLDivElement>(null);
  const myTeamIndex = config.myPickPosition - 1;
  const totalPicks = config.totalTeams * config.totalRounds;
  const latestPickNumber = draftHistory.reduce(
    (latest, pick) => Math.max(latest, pick.pickNumber),
    0
  );
  const previousLatestPickNumber = React.useRef(latestPickNumber);
  const currentView = getDraftBoardCurrentView({
    currentPick,
    myPickPosition: config.myPickPosition,
    totalTeams: config.totalTeams,
    totalRounds: config.totalRounds,
  });
  const roundNumbers = React.useMemo(
    () => getDraftBoardRoundNumbers(
      config.totalRounds,
      currentView.activeRound,
      roundWindowSize
    ),
    [config.totalRounds, currentView.activeRound, roundWindowSize]
  );
  const effectiveKeepers = React.useMemo(
    () => getEffectiveKeeperAssignments(
      preloadedKeepers,
      draftHistory,
      config.totalTeams
    ),
    [config.totalTeams, draftHistory, preloadedKeepers]
  );

  const playersById = React.useMemo(
    () => new Map(players.map((player) => [player.id, player])),
    [players]
  );
  const picksByNumber = React.useMemo(() => {
    const picks = new Map<number, BoardPick>();
    for (const keeper of effectiveKeepers) {
      if (keeper.teamIndex >= config.totalTeams || keeper.round > config.totalRounds) continue;
      const pickNumber = getPickNumberForTeamRound(
        keeper.teamIndex,
        keeper.round,
        config.totalTeams
      );
      picks.set(pickNumber, {
        playerId: keeper.playerId,
        playerName: keeper.playerName,
        position: keeper.position,
        pickNumber,
        source: 'reserved',
      });
    }
    for (const pick of draftHistory) {
      picks.set(pick.pickNumber, pick);
    }
    return picks;
  }, [config.totalRounds, config.totalTeams, draftHistory, effectiveKeepers]);
  const teamNames = React.useMemo(
    () => getTeamNames(draftHistory, config.totalTeams, myTeamIndex),
    [config.totalTeams, draftHistory, myTeamIndex]
  );
  const allTeamIndices = React.useMemo(
    () => Array.from({ length: config.totalTeams }, (_, teamIndex) => teamIndex),
    [config.totalTeams]
  );
  const latestPick = latestPickNumber > 0
    ? picksByNumber.get(latestPickNumber)
    : undefined;

  React.useEffect(() => {
    if (latestPickNumber <= previousLatestPickNumber.current) {
      previousLatestPickNumber.current = latestPickNumber;
      setSettlingPickNumber(null);
      return;
    }

    previousLatestPickNumber.current = latestPickNumber;
    setSettlingPickNumber(latestPickNumber);
    const timeout = window.setTimeout(() => {
      setSettlingPickNumber(null);
    }, 820);
    return () => { window.clearTimeout(timeout); };
  }, [latestPickNumber]);

  React.useEffect(() => {
    const targetPairs = mode === 'current'
      ? [
          [currentDesktopBoardRef.current, currentDesktopSlotRef.current],
          [currentMobileBoardRef.current, currentMobileSlotRef.current],
        ] as const
      : [[fullBoardRef.current, fullSlotRef.current]] as const;
    const reduceMotion = isMotionDisabled() ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    for (const [container, activeSlot] of targetPairs) {
      if (!container || !activeSlot || container.clientWidth === 0 || container.clientHeight === 0) {
        continue;
      }
      const containerRect = container.getBoundingClientRect();
      const activeSlotRect = activeSlot.getBoundingClientRect();
      const roundColumnWidth = Number(container.dataset.roundColumnWidth) || STICKY_ROUND_COLUMN_WIDTH;
      const target = getDraftBoardScrollTarget({
        containerTop: containerRect.top,
        containerLeft: containerRect.left,
        containerScrollTop: container.scrollTop,
        containerScrollLeft: container.scrollLeft,
        containerHeight: container.clientHeight,
        containerWidth: container.clientWidth,
        slotTop: activeSlotRect.top,
        slotLeft: activeSlotRect.left,
        slotHeight: activeSlotRect.height,
        slotWidth: activeSlotRect.width,
        stickyHeaderHeight: STICKY_HEADER_HEIGHT,
        stickyColumnWidth: roundColumnWidth,
      });
      container.scrollTo({
        top: target.top,
        left: target.left,
        behavior: reduceMotion ? 'auto' : 'smooth',
      });
    }
  }, [currentPick, mode]);

  const gridProps = {
    activeRound: currentView.activeRound,
    activeTeamIndex: currentView.activeTeamIndex,
    currentPick,
    latestPickNumber,
    settlingPickNumber,
    myTeamIndex,
    picksByNumber,
    playersById,
    roundNumbers,
    teamNames,
    totalPicks,
    totalTeams: config.totalTeams,
    upcomingMyPickNumber: currentView.upcomingMyPickNumber,
  } as const;

  return (
    <section className="overflow-hidden border-y border-border/70" aria-label="Draft board">
      <div className="flex flex-col gap-3 border-b border-border/70 bg-muted/20 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <div>
          <h2 className="text-base font-bold">Draft board</h2>
          <p className="text-xs text-muted-foreground">
            {String(config.totalTeams)} teams · {String(config.totalRounds)} rounds · snake order
          </p>
        </div>
        <div className="flex items-center justify-between gap-2 sm:justify-end">
          <Badge variant="outline" className="font-mono">
            {currentPick > totalPicks
              ? 'Complete'
              : `Pick ${formatRoundPick(currentPick, config.totalTeams)}`}
          </Badge>
          <div className="inline-flex rounded-lg bg-muted p-0.5" role="group" aria-label="Draft board view">
            <BoardModeButton active={mode === 'current'} onClick={() => { setMode('current'); }}>
              <Focus className="size-3.5" />
              <span className="sm:hidden">Current</span>
              <span className="hidden sm:inline">Current pick</span>
            </BoardModeButton>
            <BoardModeButton active={mode === 'full'} onClick={() => { setMode('full'); }}>
              <Grid3X3 className="size-3.5" />
              Full board
            </BoardModeButton>
          </div>
        </div>
      </div>

      {mode === 'current' ? (
        <div
          className="grid divide-y divide-border/70 border-b border-border/70 bg-muted/20 sm:grid-cols-3 sm:divide-x sm:divide-y-0"
          aria-live="polite"
        >
          <div className="flex min-w-0 items-center justify-between gap-3 px-3 py-2 sm:block sm:py-2.5">
            <div className="shrink-0 text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Active round</div>
            <div className="min-w-0 truncate text-right text-xs font-semibold text-foreground sm:mt-0.5 sm:text-left sm:text-sm">
              {currentView.activeRound === null
                ? 'Draft complete'
                : `Round ${String(currentView.activeRound)} · ${teamNames[currentView.activeTeamIndex]}`}
            </div>
          </div>
          <div className="flex min-w-0 items-center justify-between gap-3 px-3 py-2 sm:block sm:py-2.5">
            <div className="shrink-0 text-[9px] font-bold uppercase tracking-[0.12em] text-sky-700 dark:text-sky-300">Latest pick</div>
            <div className="min-w-0 truncate text-right text-xs font-semibold text-foreground sm:mt-0.5 sm:text-left sm:text-sm" title={latestPick?.playerName}>
              {latestPick
                ? `#${String(latestPickNumber)} · ${latestPick.playerName}`
                : 'Waiting for pick 1'}
            </div>
          </div>
          <div className="flex min-w-0 items-center justify-between gap-3 px-3 py-2 sm:block sm:py-2.5">
            <div className="shrink-0 text-[9px] font-bold uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-300">Upcoming window</div>
            <div className="min-w-0 truncate text-right text-xs font-semibold text-foreground sm:mt-0.5 sm:text-left sm:text-sm">
              {currentPick > totalPicks
                ? 'Closed'
                : currentView.upcomingMyPickNumber === currentPick
                  ? 'My Team is on the clock'
                  : currentView.upcomingMyPickNumber === null
                    ? 'No My Team picks remain'
                    : `#${String(currentPick)} to #${String(currentView.upcomingMyPickNumber)} · ${String(currentView.upcomingMyPickNumber - currentPick)} picks`}
            </div>
          </div>
        </div>
      ) : null}

      {mode === 'current' ? (
        <>
          <DraftGrid
            {...gridProps}
            boardRef={currentDesktopBoardRef}
            activeSlotRef={currentDesktopSlotRef}
            teamIndices={allTeamIndices}
            currentPickMode
            compact={false}
            wrapperClassName="hidden sm:block"
          />
          <DraftGrid
            {...gridProps}
            boardRef={currentMobileBoardRef}
            activeSlotRef={currentMobileSlotRef}
            teamIndices={currentView.mobileTeamIndices}
            currentPickMode
            compact
            wrapperClassName="sm:hidden"
          />
        </>
      ) : (
        <DraftGrid
          {...gridProps}
          boardRef={fullBoardRef}
          activeSlotRef={fullSlotRef}
          teamIndices={allTeamIndices}
          currentPickMode={false}
          compact={false}
        />
      )}
    </section>
  );
}
