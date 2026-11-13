import { useDraftState } from '@/workspace/WorkspaceProvider';
import { useDraftView } from '@/workspace/useDraftView';
import { type Player, type Position } from '@fantasy-draft/shared/league';
import { createSlotSequence, type SlotRef } from '@fantasy-draft/shared/draft';
import { type DraftType } from '@fantasy-draft/shared/sync';
import * as React from 'react';
import { useDraftSessionKey, useLandedPick } from './usePickLanded';
import { ArrowDown, ArrowLeft, ArrowRight, Clock3, Focus, Grid3X3, Hourglass } from 'lucide-react';
import './draft-board.css';
import { PlayerHeadshot } from '@/components/PlayerHeadshot';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { usePlayerDataQuery } from '@/hooks/usePlayerData';
import { getEffectiveKeeperAssignments, getKeeperPickNumber } from '@fantasy-draft/shared/draft';
import { cn } from '@/lib/utils';
import { type RecordedDraftPick } from '@/stores/draftStore';
import { STICKY_ROUND_COLUMN_WIDTH } from './draft-board-scroll';
import { boardPlayerName } from '@/lib/player-name';
import { useBoardFollowLive } from './useBoardFollowLive';
import { getDraftBoardCurrentView } from './draft-board-view';
import { useTurnStartPulse } from './useTurnStartPulse';

/** Tailwind's sm breakpoint: below it the current-pick view shows only the teams around the live pick. */
const WIDE_BOARD_QUERY = '(min-width: 40rem)';

const MOBILE_ROUND_COLUMN_WIDTH = 44;
/**
 * Narrow enough that 10 and 12 teams fit without sideways scrolling from 1280px; below 120px a cell switches to
 * its narrow layout (draft-board.css). 14+ teams still scroll.
 */
const TEAM_COLUMN_MIN_WIDTH = 92;
/** Team identity colors rotate through the `--board-team-*` design tokens (docs/design-system/tokens.json). */
const TEAM_COLOR_COUNT = 10;
function teamColor(teamIndex: number): string {
  return `var(--board-team-${String((teamIndex % TEAM_COLOR_COUNT) + 1)})`;
}

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
  slot,
  currentPick,
  isActive,
  isUpcoming,
  isMyTeam,
  compact,
}: {
  readonly pickNumber: number;
  readonly slot: SlotRef;
  readonly currentPick: number;
  readonly isActive: boolean;
  readonly isUpcoming: boolean;
  readonly isMyTeam: boolean;
  readonly compact: boolean;
}): React.ReactElement {
  const Direction = slot.endsRound ? ArrowDown : slot.direction === 'forward' ? ArrowRight : ArrowLeft;
  return (
    <div className={cn('board-empty-pick', compact && 'is-compact')}>
      <span className="board-pick-number">{slot.label}</span>
      {isActive ? (
        <div className="board-clock-label">
          <strong>{isMyTeam ? 'Your turn' : 'On the clock'}</strong>
          <Clock3 aria-hidden="true" size={20} />
        </div>
      ) : isUpcoming && isMyTeam ? (
        <span className="board-next-pick">Your pick in {String(pickNumber - currentPick)}</span>
      ) : null}
      <Direction className="board-pick-direction" aria-hidden="true" size={13} />
    </div>
  );
}

/** The narrow-column name; a long one is set tighter so it still shows whole. */
function BoardShortName({ name, position, team }: { readonly name: string; readonly position: Player['position']; readonly team: string | undefined }): React.ReactElement {
  const short = boardPlayerName(name, position, team);
  return <span className="board-name-short" data-long={short.length > 12 || undefined} aria-hidden="true">{short}</span>;
}

function FilledPick({
  pick,
  player,
  isSettling,
  compact,
  slot,
}: {
  readonly pick: BoardPick;
  readonly player?: Player;
  readonly isSettling: boolean;
  readonly compact: boolean;
  readonly slot: SlotRef;
}): React.ReactElement {
  const Direction = slot.endsRound ? ArrowDown : slot.direction === 'forward' ? ArrowRight : ArrowLeft;
  return (
    <div className={cn(
      'board-filled-pick',
      `board-position-${pick.position.toLowerCase()}`,
      compact && 'is-compact',
      pick.source === 'provisional' && 'is-provisional',
      pick.source === 'reserved' && 'is-keeper',
      isSettling && 'draft-pick-confirmed'
    )}>
      <span className="board-pick-number">{slot.label}</span>
      <div data-pick-identity className="board-player-identity">
        {/* Narrow columns show the short name; the full one stays for screen readers and the tooltip. */}
        <div className="board-player-name" title={pick.playerName}>
          <span className="board-name-full">{pick.playerName}</span>
          <BoardShortName name={pick.playerName} position={pick.position} team={player?.team} />
        </div>
        <div className="board-player-meta">
          {pick.position}{player?.team ? ` · ${player.team}` : ''}
          {player?.byeWeek ? <span className="board-player-bye">{` (${String(player.byeWeek)})`}</span> : null}
          {pick.source === 'reserved' ? ' · Keeper' : ''}
        </div>
        {/* An icon, not 8px text: the slot has no room for readable 11px copy. The name stays for screen readers and the tooltip. */}
        {pick.source === 'provisional' ? (
          <span className="board-provisional-label" title="Provisional Pick">
            <Hourglass aria-hidden="true" size={11} /><span className="sr-only">Provisional Pick</span>
          </span>
        ) : null}
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
  readonly boardHeight: number;
  readonly boardRef: React.RefObject<HTMLDivElement>;
  readonly compact: boolean;
  readonly currentPick: number;
  readonly currentPickMode: boolean;
  readonly draftType: DraftType;
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
}

function DraftGrid({
  activeRound,
  activeTeamIndex,
  activeSlotRef,
  boardHeight,
  boardRef,
  compact,
  currentPick,
  currentPickMode,
  draftType,
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
}: DraftGridProps): React.ReactElement {
  const totalRounds = Math.ceil(totalPicks / totalTeams);
  const order = React.useMemo(() => createSlotSequence({ type: draftType, teams: totalTeams, rounds: totalRounds }),
    [draftType, totalTeams, totalRounds]);
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
      className="board-scroll overflow-auto"
      // A keyboard-reachable, named scroll region, so the board can be scrolled without a mouse (axe
      // scrollable-region-focusable); arrow keys scroll it once focused.
      tabIndex={0}
      role="region"
      aria-label="Draft board, scrollable"
      // Set on the scroller, not the section, so a height change restyles only the elements that read it.
      style={{ '--draft-board-height': `${String(boardHeight)}px` } as React.CSSProperties}
    >
      {/* Table semantics for assistive tech: rows use display: contents, so cells stay direct grid items and the layout is unchanged. */}
      <div className="board-grid grid w-full" style={gridStyle} role="table" aria-label="Draft board"
        aria-rowcount={totalRounds + 1} aria-colcount={teamIndices.length + 1}>
        <div role="row" aria-rowindex={1} className="contents">
        <div role="columnheader" className="board-corner sticky left-0 top-0 z-30">
          Round
        </div>
        {teamIndices.map((teamIndex) => {
          const isMyTeam = teamIndex === myTeamIndex;
          const isActiveTeam = currentPick <= totalPicks && teamIndex === activeTeamIndex;
          return (
            <div
              key={`team-${String(teamIndex)}`}
              role="columnheader"
              className={cn(
                'board-team-header sticky top-0 z-20',
                isMyTeam && 'is-my-team',
                isActiveTeam && 'is-active-team'
              )}
            >
              <span className="board-team-avatar" style={{ '--team-color': teamColor(teamIndex) } as React.CSSProperties} aria-hidden="true">
                {String(teamIndex + 1).padStart(2, '0')}
              </span>
              <span className="board-team-name" title={teamNames[teamIndex]}>{teamNames[teamIndex]}</span>
              {isMyTeam ? <span className="sr-only">, My Team</span> : null}
            </div>
          );
        })}
        </div>

        {roundNumbers.map((roundNumber) => {
          const isActiveRound = activeRound === roundNumber;
          return (
            <div key={`round-${String(roundNumber)}`} role="row" aria-rowindex={roundNumber + 1} className="contents">
              <div
                role="rowheader"
                aria-label={`Round ${String(roundNumber)}`}
                className={cn(
                  'board-round sticky left-0 z-10',
                  isActiveRound && 'is-active-round'
                )}
                aria-current={isActiveRound ? 'step' : undefined}
              >
                <span>R{String(roundNumber)}</span>
                {currentPickMode && isActiveRound ? (
                  <span className="board-round-now">Now</span>
                ) : null}
              </div>
              {teamIndices.map((teamIndex) => {
                const slot = order.forTeamRound(teamIndex, roundNumber);
                const pickNumber = slot.pick;
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
                    role="cell"
                    ref={isActive ? activeSlotRef : undefined}
                    className={cn(
                      'board-slot',
                      isMyTeam && 'is-my-team',
                      isMyTeam && roundNumber === roundNumbers[roundNumbers.length - 1] && 'is-last-round',
                      isActive && 'is-on-clock',
                      isUpcoming && isMyTeam && 'is-next-pick'
                    )}
                    aria-label={`Pick ${slot.label}${pick ? `, ${pick.playerName}${pick.source === 'provisional' ? ', Provisional Pick' : ''}${isLatest ? ', latest pick' : ''}` : ''}${isActive ? ', on the clock' : ''}${isMyTeam ? ', My Team' : ''}${isUpcoming ? ', in the upcoming selection window' : ''}`}
                  >
                    {pick ? (
                      <FilledPick
                        pick={pick}
                        slot={slot}
                        player={playersById.get(pick.playerId)}
                        isSettling={pickNumber === settlingPickNumber}
                        compact={compact}
                      />
                    ) : (
                      <EmptyPick
                        pickNumber={pickNumber}
                        slot={slot}
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
            </div>
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
        'inline-flex h-8 items-center justify-center gap-1.5 rounded-xs px-3 text-xs font-semibold outline-none transition-[background-color,color,box-shadow] focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'bg-foreground text-background'
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
  boardHeight = 320,
  fillsSpace = false,
  roundWindowSize,
  toolbarActions,
}: {
  /** Height of the scrolling pick grid, in pixels. */
  readonly boardHeight?: number;
  /** Grow the pick grid into all available space instead of using boardHeight. */
  readonly fillsSpace?: boolean;
  readonly roundWindowSize?: number;
  readonly toolbarActions?: React.ReactNode;
} = {}): React.ReactElement {
  const { players } = usePlayerDataQuery();
  const config = useDraftState((state) => state.config);
  const currentPick = useDraftView((view) => view.currentPick);
  const isMyTurn = useDraftView((view) => view.isMyTurn);
  const draftHistory = useDraftState((state) => state.draftHistory);
  const preloadedKeepers = useDraftState((state) => state.preloadedKeepers);
  const [mode, setMode] = React.useState<BoardMode>('current');
  const turnIndicatorRef = React.useRef<HTMLSpanElement>(null);
  const [settlingPickNumber, setSettlingPickNumber] = React.useState<number | null>(null);
  const isWideBoard = useMediaQuery(WIDE_BOARD_QUERY);
  const currentBoardRef = React.useRef<HTMLDivElement>(null);
  const currentSlotRef = React.useRef<HTMLDivElement>(null);
  const fullBoardRef = React.useRef<HTMLDivElement>(null);
  const fullSlotRef = React.useRef<HTMLDivElement>(null);
  const myTeamIndex = config.myPickPosition - 1;
  const totalPicks = config.totalTeams * config.totalRounds;
  const latestPickNumber = draftHistory.reduce(
    (latest, pick) => Math.max(latest, pick.pickNumber),
    0
  );
  // Only a pick landing in this session flashes its cell: a history loaded from storage or a switch to another
  // session raises the latest pick number too, and flashes nothing.
  const landedPick = useLandedPick(draftHistory, useDraftSessionKey());
  const currentView = getDraftBoardCurrentView({
    currentPick,
    myPickPosition: config.myPickPosition,
    totalTeams: config.totalTeams,
    totalRounds: config.totalRounds,
    draftType: config.draftType,
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
      config.totalTeams,
      config.draftType
    ),
    [config.totalTeams, config.draftType, draftHistory, preloadedKeepers]
  );

  const playersById = React.useMemo(
    () => new Map(players.map((player) => [player.id, player])),
    [players]
  );
  const picksByNumber = React.useMemo(() => {
    const picks = new Map<number, BoardPick>();
    for (const keeper of effectiveKeepers) {
      if (keeper.teamIndex >= config.totalTeams || keeper.round > config.totalRounds) continue;
      const pickNumber = getKeeperPickNumber(keeper, config.totalTeams, config.draftType);
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
  }, [config.totalRounds, config.totalTeams, config.draftType, draftHistory, effectiveKeepers]);
  const teamNames = React.useMemo(
    () => getTeamNames(draftHistory, config.totalTeams, myTeamIndex),
    [config.totalTeams, draftHistory, myTeamIndex]
  );
  const allTeamIndices = React.useMemo(
    () => Array.from({ length: config.totalTeams }, (_, teamIndex) => teamIndex),
    [config.totalTeams]
  );

  React.useEffect(() => {
    if (!landedPick) {
      setSettlingPickNumber(null);
      return;
    }
    setSettlingPickNumber(landedPick.pickNumber);
    // Just past the 200ms confirm highlight (index.css), so the class never cuts the animation short.
    const timeout = window.setTimeout(() => {
      setSettlingPickNumber(null);
    }, 220);
    return () => { window.clearTimeout(timeout); };
  }, [landedPick]);

  const { followLive, jumpToLive } = useBoardFollowLive({
    mode,
    current: { board: currentBoardRef, slot: currentSlotRef },
    full: { board: fullBoardRef, slot: fullSlotRef },
    livePick: currentPick,
    layoutKey: `${String(currentPick)}:${String(boardHeight)}:${String(fillsSpace)}:${String(isWideBoard)}`,
  });

  const slotSequence = React.useMemo(
    () => createSlotSequence({ type: config.draftType, teams: config.totalTeams, rounds: config.totalRounds }),
    [config.draftType, config.totalRounds, config.totalTeams]
  );
  // A keeper slot is filled automatically, so it is never the user's selection.
  const isKeeperOnClock = picksByNumber.get(currentPick)?.source === 'reserved';
  const isYourTurn = !isKeeperOnClock && isMyTurn;
  useTurnStartPulse(turnIndicatorRef, isYourTurn ? currentPick : null);

  const gridProps = {
    activeRound: currentView.activeRound,
    activeTeamIndex: currentView.activeTeamIndex,
    boardHeight,
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
    draftType: config.draftType,
    upcomingMyPickNumber: currentView.upcomingMyPickNumber,
  } as const;

  return (
    <section className={cn('draft-board', fillsSpace && 'is-filling')} aria-label="Draft board">
      <div className="board-toolbar flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-start sm:gap-5">
          <div className="min-w-0">
            <h2 className="board-title">Draft board</h2>
            <p className="board-subtitle">
              {String(config.totalTeams)}-team {config.draftType} · {String(config.totalRounds)} rounds
            </p>
          </div>
          {toolbarActions}
        </div>
        <div className="flex items-center justify-between gap-2 sm:justify-end">
          {/* Not a live region: the header turn banner announces turn changes; this chip changes every pick. */}
          <span ref={turnIndicatorRef} className={cn("board-current-pick", isYourTurn && "is-your-turn", currentPick > totalPicks && "is-complete")}><Clock3 size={14} aria-hidden="true" />
            {currentPick > totalPicks
              ? 'Complete'
              : `${isYourTurn ? 'Your turn ·' : isKeeperOnClock ? 'Keeper ·' : 'Pick'} ${slotSequence.label(currentPick)}`}
          </span>
          {!followLive ? (
            <button type="button" className="board-jump-live" onClick={jumpToLive}>
              <ArrowDown className="size-3.5" aria-hidden="true" /> Jump to live pick
            </button>
          ) : null}
          <div className="board-view-toggle" role="group" aria-label="Draft board view">
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
        <DraftGrid
          {...gridProps}
          boardRef={currentBoardRef}
          activeSlotRef={currentSlotRef}
          teamIndices={isWideBoard ? allTeamIndices : currentView.mobileTeamIndices}
          currentPickMode
          compact={!isWideBoard}
        />
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
