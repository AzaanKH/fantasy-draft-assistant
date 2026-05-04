/**
 * Player Table Component
 *
 * Displays available players with:
 * - Position filtering
 * - Search filtering
 * - Sortable columns
 * - Highlight-level row styling
 * - Draft action button
 */

import { useMemo } from 'react';
import type { Player, Position, HighlightLevel } from '@fantasy-draft/shared';
import { POSITIONS } from '@fantasy-draft/shared';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useDraftStore } from '@/stores/draftStore';
import { useFilteredPlayers } from '@/hooks/usePlayerData';
import type { SortField } from '@/lib/calculations';
import { cn } from '@/lib/utils';

/**
 * Position filter buttons
 */
function PositionFilter() {
  const filter = useDraftStore((state) => state.filter);
  const setPositionFilter = useDraftStore((state) => state.setPositionFilter);

  const positions: Array<Position | 'ALL'> = ['ALL', ...POSITIONS];

  return (
    <div className="flex gap-1 flex-wrap">
      {positions.map((pos) => (
        <Button
          key={pos}
          variant={filter.position === pos ? 'default' : 'outline'}
          size="sm"
          onClick={() => setPositionFilter(pos)}
          className="min-w-12"
        >
          {pos}
        </Button>
      ))}
    </div>
  );
}

/**
 * Search input for player name/team filtering
 */
function SearchFilter() {
  const searchQuery = useDraftStore((state) => state.filter.searchQuery);
  const setSearchQuery = useDraftStore((state) => state.setSearchQuery);

  return (
    <input
      type="text"
      placeholder="Search players..."
      value={searchQuery}
      onChange={(e) => setSearchQuery(e.target.value)}
      className="px-3 py-2 border rounded-md bg-background text-foreground w-64 text-sm"
    />
  );
}

/**
 * Sortable column header
 */
interface SortableHeaderProps {
  field: SortField;
  children: React.ReactNode;
  className?: string;
}

function SortableHeader({ field, children, className }: SortableHeaderProps) {
  const sort = useDraftStore((state) => state.sort);
  const setSort = useDraftStore((state) => state.setSort);

  const isActive = sort.field === field;
  const direction = isActive ? sort.direction : null;

  return (
    <TableHead
      className={cn('cursor-pointer select-none hover:bg-muted/50', className)}
      onClick={() => setSort(field)}
    >
      <span className="flex items-center gap-1">
        {children}
        {isActive && (
          <span className="text-xs">
            {direction === 'asc' ? '↑' : '↓'}
          </span>
        )}
      </span>
    </TableHead>
  );
}

/**
 * Highlight badge based on player value
 */
function HighlightBadge({ level }: { level: HighlightLevel }) {
  const config: Record<
    HighlightLevel,
    { label: string; className: string }
  > = {
    'strong-buy': {
      label: 'Strong Buy',
      className: 'bg-green-500/20 text-green-700 border-green-500/30',
    },
    'good-value': {
      label: 'Good Value',
      className: 'bg-yellow-500/20 text-yellow-700 border-yellow-500/30',
    },
    neutral: {
      label: '',
      className: '',
    },
    avoid: {
      label: 'Avoid',
      className: 'bg-red-500/20 text-red-700 border-red-500/30',
    },
  };

  const { label, className } = config[level];
  if (!label) return null;

  return (
    <Badge variant="outline" className={className}>
      {label}
    </Badge>
  );
}

/**
 * Position badge with color coding
 */
function PositionBadge({ position }: { position: Position }) {
  const colors: Record<Position, string> = {
    QB: 'bg-red-500/20 text-red-700 border-red-500/30',
    RB: 'bg-green-500/20 text-green-700 border-green-500/30',
    WR: 'bg-blue-500/20 text-blue-700 border-blue-500/30',
    TE: 'bg-orange-500/20 text-orange-700 border-orange-500/30',
    K: 'bg-purple-500/20 text-purple-700 border-purple-500/30',
    DEF: 'bg-gray-500/20 text-gray-700 border-gray-500/30',
  };

  return (
    <Badge variant="outline" className={cn('font-mono', colors[position])}>
      {position}
    </Badge>
  );
}

/**
 * Value score display with color coding
 */
function ValueDisplay({ value }: { value: number }) {
  const className = useMemo(() => {
    if (value >= 10) return 'text-green-600 font-semibold';
    if (value >= 5) return 'text-green-500';
    if (value <= -15) return 'text-red-600 font-semibold';
    if (value <= -5) return 'text-red-500';
    return 'text-muted-foreground';
  }, [value]);

  const prefix = value > 0 ? '+' : '';

  return <span className={className}>{prefix}{value}</span>;
}

/**
 * Row styling based on highlight level
 */
function getRowClassName(level: HighlightLevel): string {
  const classes: Record<HighlightLevel, string> = {
    'strong-buy': 'bg-green-50 dark:bg-green-950/20 hover:bg-green-100 dark:hover:bg-green-950/30',
    'good-value': 'bg-yellow-50 dark:bg-yellow-950/20 hover:bg-yellow-100 dark:hover:bg-yellow-950/30',
    neutral: '',
    avoid: 'bg-red-50 dark:bg-red-950/20 hover:bg-red-100 dark:hover:bg-red-950/30',
  };
  return classes[level];
}

/**
 * Single player row
 */
interface PlayerRowProps {
  player: Player;
  onDraft: (player: Player) => void;
}

function PlayerRow({ player, onDraft }: PlayerRowProps) {
  return (
    <TableRow className={getRowClassName(player.highlightLevel)}>
      <TableCell className="font-medium">{player.ecrRank}</TableCell>
      <TableCell>
        <div className="flex flex-col">
          <span className="font-medium">{player.name}</span>
          <span className="text-xs text-muted-foreground">
            {player.team} · Bye {player.byeWeek}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <PositionBadge position={player.position} />
      </TableCell>
      <TableCell className="text-center">{player.sleeperAdp}</TableCell>
      <TableCell className="text-center">
        <ValueDisplay value={player.valueScore} />
      </TableCell>
      <TableCell>
        <HighlightBadge level={player.highlightLevel} />
      </TableCell>
      <TableCell>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onDraft(player)}
        >
          Draft
        </Button>
      </TableCell>
    </TableRow>
  );
}

/**
 * Main PlayerTable component
 */
export function PlayerTable() {
  const { players, totalCount, filteredCount, isLoading, isError, error } =
    useFilteredPlayers();

  const markPlayerDrafted = useDraftStore((state) => state.markPlayerDrafted);
  const addToMyRoster = useDraftStore((state) => state.addToMyRoster);
  const config = useDraftStore((state) => state.config);
  const currentPick = useDraftStore((state) => state.currentPick);

  // Calculate current team (for draft tracking)
  const currentTeamIndex = useMemo(() => {
    const round = Math.ceil(currentPick / config.totalTeams);
    const pickInRound = ((currentPick - 1) % config.totalTeams) + 1;
    const isOddRound = round % 2 === 1;
    return isOddRound ? pickInRound - 1 : config.totalTeams - pickInRound;
  }, [currentPick, config.totalTeams]);

  const isMyTurn = currentTeamIndex === config.myPickPosition - 1;

  const handleDraft = (player: Player) => {
    const teamName = isMyTurn ? 'My Team' : `Team ${currentTeamIndex + 1}`;
    markPlayerDrafted(
      player.id,
      player.name,
      player.position,
      currentTeamIndex,
      teamName
    );

    if (isMyTurn) {
      addToMyRoster(player);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading player data...</div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-destructive">
          Error loading data: {error?.message ?? 'Unknown error'}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <PositionFilter />
        <SearchFilter />
      </div>

      {/* Stats bar */}
      <div className="flex gap-4 text-sm text-muted-foreground">
        <span>Pick #{currentPick}</span>
        <span>·</span>
        <span>{filteredCount} of {totalCount} players</span>
        {isMyTurn && (
          <>
            <span>·</span>
            <span className="text-green-600 font-medium">Your Pick!</span>
          </>
        )}
      </div>

      {/* Table */}
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHeader field="ecrRank" className="w-16">
              ECR
            </SortableHeader>
            <SortableHeader field="name">Player</SortableHeader>
            <TableHead className="w-20">Pos</TableHead>
            <SortableHeader field="sleeperAdp" className="w-20 text-center">
              ADP
            </SortableHeader>
            <SortableHeader field="valueScore" className="w-20 text-center">
              Value
            </SortableHeader>
            <TableHead className="w-28">Signal</TableHead>
            <TableHead className="w-20">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {players.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground h-32">
                No players found
              </TableCell>
            </TableRow>
          ) : (
            players.map((player) => (
              <PlayerRow
                key={player.id}
                player={player}
                onDraft={handleDraft}
              />
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
