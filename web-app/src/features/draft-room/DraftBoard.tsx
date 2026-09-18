import * as React from 'react';
import type { Player, Position } from '@fantasy-draft/shared';
import { ArrowDown, ArrowLeft, ArrowRight, Clock3, Focus, Grid3X3 } from 'lucide-react';
import './draft-board.css';
import { PlayerHeadshot } from '@/components/PlayerHeadshot';
import { isMotionDisabled } from '@/components/motion';
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

const STICKY_HEADER_HEIGHT = 76;
const STICKY_ROUND_COLUMN_WIDTH = 56;
const MOBILE_ROUND_COLUMN_WIDTH = 44;
const TEAM_COLUMN_MIN_WIDTH = 116;

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
  const round = Math.ceil(pickNumber / totalTeams);
  const Direction = pickNumber % totalTeams === 0 ? ArrowDown : round % 2 === 1 ? ArrowRight : ArrowLeft;
  return (
    <div className={cn('board-empty-pick', compact && 'is-compact')}>
      <span className="board-pick-number">{formatRoundPick(pickNumber, totalTeams)}</span>
      {isActive ? (
        <div className="board-clock-label">
          <strong>{isMyTeam ? 'Your pick' : 'On the clock'}</strong>
          <Clock3 aria-hidden="true" size={20} />
        </div>
      ) : isUpcoming && isMyTeam ? (
        <span className="board-next-pick">Your pick in {String(pickNumber - currentPick)}</span>
      ) : null}
      <Direction className="board-pick-direction" aria-hidden="true" size={13} />
    </div>
  );
}

function FilledPick({
  pick,
  player,
  isSettling,
  compact,
  totalTeams,
}: {
  readonly pick: BoardPick;
  readonly player?: Player;
  readonly isSettling: boolean;
  readonly compact: boolean;
  readonly totalTeams: number;
}): React.ReactElement {
  const round = Math.ceil(pick.pickNumber / totalTeams);
  const Direction = pick.pickNumber % totalTeams === 0 ? ArrowDown : round % 2 === 1 ? ArrowRight : ArrowLeft;
  return (
    <div className={cn(
      'board-filled-pick',
      `board-position-${pick.position.toLowerCase()}`,
      compact && 'is-compact',
      pick.source === 'provisional' && 'is-provisional',
      isSettling && 'draft-pick-confirmed'
    )}>
      <span className="board-pick-number">{formatRoundPick(pick.pickNumber, totalTeams)}</span>
      <div data-pick-identity className="board-player-identity">
        <div className="board-player-name" title={pick.playerName}>{pick.playerName}</div>
        <div className="board-player-meta">
          {pick.position}{player?.team ? ` · ${player.team}` : ''}
          {player?.byeWeek ? ` (${String(player.byeWeek)})` : ''}
          {pick.source === 'reserved' ? ' · Keeper' : ''}
        </div>
        {pick.source === 'provisional' ? <span className="board-provisional-label">Provisional Pick</span> : null}
      </div>
      <Direction className="board-pick-direction" aria-hidden="true" size={13} />
      {!compact ? (
        <span data-pick-identity className="board-player-photo">
          <PlayerHeadshot
            playerId={pick.playerId}
            name={pick.playerName}
            position={pick.position}
            className="size-full rounded-tl-lg"
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
        'board-scroll h-[clamp(380px,57vh,650px)] overflow-auto',
        wrapperClassName
      )}
    >
      <div className="board-grid grid w-full" style={gridStyle}>
        <div className="board-corner sticky left-0 top-0 z-30">
          Round
        </div>
        {teamIndices.map((teamIndex) => {
          const isMyTeam = teamIndex === myTeamIndex;
          const isActiveTeam = currentPick <= totalPicks && teamIndex === activeTeamIndex;
          return (
            <div
              key={`team-${String(teamIndex)}`}
              className={cn(
                'board-team-header sticky top-0 z-20',
                isMyTeam && 'is-my-team',
                isActiveTeam && 'is-active-team'
              )}
            >
              <span className="board-team-avatar" style={{ '--team-color': ['#00aaff', '#00cbb6', '#9464ff', '#ff729b', '#bd63f5', '#ffb15b', '#37dda4', '#ff791b', '#21bbe9', '#e660ef'][teamIndex % 10] } as React.CSSProperties} aria-hidden="true">
                {String(teamIndex + 1).padStart(2, '0')}
              </span>
              <span className="board-team-name" title={teamNames[teamIndex]}>{teamNames[teamIndex]}{isMyTeam ? <span className="board-team-dot" /> : null}</span>
            </div>
          );
        })}

        {roundNumbers.map((roundNumber) => {
          const isActiveRound = activeRound === roundNumber;
          return (
            <React.Fragment key={`round-${String(roundNumber)}`}>
              <div
                className={cn(
                  'board-round sticky left-0 z-10',
                  isActiveRound && 'is-active-round'
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
                return (
                  <div
                    key={`pick-${String(pickNumber)}`}
                    ref={isActive ? activeSlotRef : undefined}
                    className={cn(
                      'board-slot',
                      isMyTeam && 'is-my-team',
                      isMyTeam && roundNumber === roundNumbers[roundNumbers.length - 1] && 'is-last-round',
                      isActive && 'is-on-clock',
                      isUpcoming && isMyTeam && 'is-next-pick'
                    )}
                    aria-label={`Pick ${formatRoundPick(pickNumber, totalTeams)}${pick ? `, ${pick.playerName}${pick.source === 'provisional' ? ', Provisional Pick' : ''}${isLatest ? ', latest pick' : ''}` : ''}${isActive ? ', on the clock' : ''}${isMyTeam ? ', My Team' : ''}${isUpcoming ? ', in the upcoming selection window' : ''}`}
                  >
                    {pick ? (
                      <FilledPick
                        pick={pick}
                        totalTeams={totalTeams}
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
    <section className="draft-board" aria-label="Draft board">
      <div className="board-toolbar flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <div>
          <h2 className="text-base font-bold" title={`${String(config.totalTeams)} teams · ${String(config.totalRounds)} rounds · snake order`}>Draft board</h2>
        </div>
        <div className="flex items-center justify-between gap-2 sm:justify-end">
          <span role="status" className={cn("board-current-pick", currentView.upcomingMyPickNumber === currentPick && "is-your-turn")}><Clock3 size={14} aria-hidden="true" />
            {currentPick > totalPicks
              ? 'Complete'
              : `${currentView.upcomingMyPickNumber === currentPick ? 'Your pick' : 'Pick'} ${formatRoundPick(currentPick, config.totalTeams)}`}
          </span>
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
