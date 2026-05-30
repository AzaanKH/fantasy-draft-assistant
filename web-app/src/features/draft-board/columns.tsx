/**
 * Column Definitions for Player DataTable
 *
 * Defines sortable columns with custom cell rendering:
 * - Rank, Name, Position, Team, Bye, Value Score, Highlight
 */

import type { ColumnDef } from '@tanstack/react-table';
import type { Player, Position, HighlightLevel } from '@fantasy-draft/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowUpDown, ArrowUp, ArrowDown, Eye } from 'lucide-react';
import { cn, formatSignedNumber } from '@/lib/utils';

/**
 * Position badge with color coding
 */
function PositionBadge({ position }: { position: Position }) {
  const colors: Record<Position, string> = {
    QB: 'bg-red-500/20 text-red-700 dark:text-red-400 border-red-500/30',
    RB: 'bg-green-500/20 text-green-700 dark:text-green-400 border-green-500/30',
    WR: 'bg-blue-500/20 text-blue-700 dark:text-blue-400 border-blue-500/30',
    TE: 'bg-orange-500/20 text-orange-700 dark:text-orange-400 border-orange-500/30',
    K: 'bg-purple-500/20 text-purple-700 dark:text-purple-400 border-purple-500/30',
    DEF: 'bg-gray-500/20 text-gray-700 dark:text-gray-400 border-gray-500/30',
  };

  return (
    <Badge variant="outline" className={cn('font-mono text-xs', colors[position])}>
      {position}
    </Badge>
  );
}

function CompactMetric({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="flex flex-col leading-tight">
      <span className={cn('font-mono text-sm font-semibold tabular-nums', className)}>
        {value}
      </span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}

/**
 * Highlight badge with color-coded background
 */
function HighlightBadge({ level }: { level: HighlightLevel }) {
  const config: Record<HighlightLevel, { label: string; className: string }> = {
    'strong-buy': {
      label: 'Strong Buy',
      className: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    },
    'good-value': {
      label: 'Good Value',
      className: 'border-amber-500/35 bg-amber-500/15 text-amber-800 dark:text-amber-300',
    },
    neutral: {
      label: '',
      className: '',
    },
    avoid: {
      label: 'Avoid',
      className: 'border-red-500/35 bg-red-500/15 text-red-700 dark:text-red-300',
    },
  };

  const { label, className } = config[level];
  if (!label) return <span className="text-muted-foreground text-xs">-</span>;

  return (
    <Badge className={className}>
      {label}
    </Badge>
  );
}

function SignalChip({ level }: { level: HighlightLevel }) {
  const config: Record<HighlightLevel, { label: string; className: string }> = {
    'strong-buy': {
      label: 'Strong value',
      className: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    },
    'good-value': {
      label: 'Value',
      className: 'border-amber-500/35 bg-amber-500/15 text-amber-800 dark:text-amber-300',
    },
    neutral: {
      label: '',
      className: '',
    },
    avoid: {
      label: 'Caution',
      className: 'border-red-500/35 bg-red-500/15 text-red-700 dark:text-red-300',
    },
  };

  const { label, className } = config[level];
  if (!label) return null;

  return (
    <Badge variant="outline" className={cn('h-5 px-1.5 text-[10px]', className)}>
      {label}
    </Badge>
  );
}

/**
 * Value score display with positive/negative coloring
 */
function ValueDisplay({ value }: { value: number }) {
  const className = cn(
    'font-mono text-sm tabular-nums',
    Math.abs(value) >= 5 ? 'font-semibold text-foreground' : 'text-muted-foreground'
  );

  const prefix = value > 0 ? '+' : '';
  return <span className={className}>{prefix}{value}</span>;
}

function MarketDeltaDisplay({ player }: { player: Player }) {
  const delta = player.valueScore;
  const label = delta > 0 ? 'Steal' : delta < 0 ? 'Reach' : 'Even';

  return (
    <div className="flex flex-col">
      <ValueDisplay value={delta} />
      <span className="text-[11px] text-muted-foreground">
        FP #{player.ecrRank} / SL #{player.marketRank} {label}
      </span>
    </div>
  );
}

function renderMarketDisplay(player: Player) {
  const delta = player.valueScore;
  const label = delta > 0 ? 'Steal' : delta < 0 ? 'Reach' : 'Even';

  return (
    <div className="flex flex-col leading-tight">
      <ValueDisplay value={delta} />
      <span className="text-[11px] text-muted-foreground">
        FP {player.ecrRank} / SL {player.marketRank}
      </span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}

function renderValueDisplay(player: Player) {
  return (
    <div className="grid min-w-[120px] grid-cols-2 gap-3">
      <CompactMetric label="Proj" value={player.projectedPoints.toFixed(1)} />
      <CompactMetric
        label="VOR"
        value={formatSignedNumber(player.valueOverReplacement, 1)}
        className="text-foreground"
      />
    </div>
  );
}

function renderPredictionDisplay(player: Player) {
  return (
    <div className="flex flex-col">
      <span className="font-mono text-sm font-medium">
        {player.projectedPoints.toFixed(1)}
      </span>
      <span className="text-[11px] text-muted-foreground capitalize">
        {player.predictionSource}
      </span>
    </div>
  );
}

function renderRangeDisplay(player: Player) {
  return (
    <div className="flex flex-col">
      <span className="font-mono text-sm">
        {player.floorScore.toFixed(1)} / {player.ceilingScore.toFixed(1)}
      </span>
      <span className="text-[11px] text-muted-foreground">Floor / Ceiling</span>
    </div>
  );
}

function renderRiskDisplay(player: Player) {
  const risk = Math.max(player.injuryRiskScore, player.uncertaintyScore);
  const className = cn(
    'font-mono text-sm',
    risk >= 7 ? 'font-semibold text-foreground' : 'text-muted-foreground'
  );

  return (
    <div className="flex flex-col">
      <span className={className}>{risk.toFixed(1)}</span>
      <span className="text-[11px] text-muted-foreground">
        Inj {player.injuryRiskScore.toFixed(1)} / Var {player.uncertaintyScore.toFixed(1)}
      </span>
    </div>
  );
}

/**
 * Sortable header component
 */
interface SortableHeaderProps {
  column: {
    getIsSorted: () => false | 'asc' | 'desc';
    toggleSorting: (desc?: boolean) => void;
  };
  children: React.ReactNode;
  className?: string;
}

function SortableHeader({ column, children, className }: SortableHeaderProps) {
  const sorted = column.getIsSorted();

  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn('-ml-3 h-8', className)}
      onClick={() => {
        column.toggleSorting(sorted === 'asc');
      }}
    >
      {children}
      {sorted === 'asc' ? (
        <ArrowUp className="ml-1 h-4 w-4" />
      ) : sorted === 'desc' ? (
        <ArrowDown className="ml-1 h-4 w-4" />
      ) : (
        <ArrowUpDown className="ml-1 h-4 w-4 opacity-50" />
      )}
    </Button>
  );
}

/**
 * Column definitions for Player table
 */
export const columns: ColumnDef<Player>[] = [
  {
    accessorKey: 'ecrRank',
    header: ({ column }) => (
      <SortableHeader column={column}>Rank</SortableHeader>
    ),
    cell: ({ row }) => (
      <span className="font-mono text-sm font-medium">
        {row.getValue('ecrRank')}
      </span>
    ),
  },
  {
    accessorKey: 'name',
    header: ({ column }) => (
      <SortableHeader column={column}>Name</SortableHeader>
    ),
    cell: ({ row }) => {
      const player = row.original;
      return (
        <div className="flex flex-col">
          <span className="font-medium">{player.name}</span>
          {player.isContractYear && (
            <span className="text-xs text-orange-500">Contract Year</span>
          )}
        </div>
      );
    },
  },
  {
    accessorKey: 'position',
    header: 'Pos',
    cell: ({ row }) => <PositionBadge position={row.getValue('position')} />,
    filterFn: (row, id, value: string[]) => {
      return value.includes(row.getValue(id));
    },
  },
  {
    accessorKey: 'team',
    header: ({ column }) => (
      <SortableHeader column={column}>Team</SortableHeader>
    ),
    cell: ({ row }) => (
      <span className="font-mono text-sm">{row.getValue('team')}</span>
    ),
  },
  {
    accessorKey: 'byeWeek',
    header: ({ column }) => (
      <SortableHeader column={column}>Bye</SortableHeader>
    ),
    cell: ({ row }) => (
      <span className="text-muted-foreground text-sm">
        {row.getValue('byeWeek')}
      </span>
    ),
  },
  {
    accessorKey: 'sleeperAdp',
    header: ({ column }) => (
      <SortableHeader column={column}>Sleeper</SortableHeader>
    ),
    cell: ({ row }) => (
      <span className="font-mono text-sm text-muted-foreground">
        {row.getValue('sleeperAdp')}
      </span>
    ),
  },
  {
    accessorKey: 'valueScore',
    header: ({ column }) => <SortableHeader column={column}>FP vs SL</SortableHeader>,
    cell: ({ row }) => <MarketDeltaDisplay player={row.original} />,
  },
  {
    accessorKey: 'projectedPoints',
    header: ({ column }) => <SortableHeader column={column}>Proj</SortableHeader>,
    cell: ({ row }) => renderPredictionDisplay(row.original),
  },
  {
    accessorKey: 'valueOverReplacement',
    header: ({ column }) => <SortableHeader column={column}>VOR</SortableHeader>,
    cell: ({ row }) => (
      <span className="font-mono text-sm">
        {row.original.valueOverReplacement.toFixed(1)}
      </span>
    ),
  },
  {
    accessorKey: 'ceilingScore',
    header: ({ column }) => <SortableHeader column={column}>Range</SortableHeader>,
    cell: ({ row }) => renderRangeDisplay(row.original),
  },
  {
    id: 'injuryRiskScore',
    accessorFn: (player) => Math.max(player.injuryRiskScore, player.uncertaintyScore),
    header: ({ column }) => <SortableHeader column={column}>Risk</SortableHeader>,
    cell: ({ row }) => renderRiskDisplay(row.original),
  },
  {
    accessorKey: 'highlightLevel',
    header: 'Signal',
    cell: ({ row }) => <HighlightBadge level={row.getValue('highlightLevel')} />,
    enableSorting: false,
  },
];

/**
 * Column definitions with draft action button
 */
export function getColumnsWithActions(
  onDraft: (player: Player) => void,
  options: {
    advanced?: boolean;
    onInspect?: (player: Player) => void;
  } = {}
): ColumnDef<Player>[] {
  const compactColumns: ColumnDef<Player>[] = [
    {
      accessorKey: 'ecrRank',
      header: ({ column }) => (
        <SortableHeader column={column}>Rank</SortableHeader>
      ),
      cell: ({ row }) => (
        <span className="font-mono text-sm font-semibold text-muted-foreground">
          {row.getValue('ecrRank')}
        </span>
      ),
    },
    {
      accessorKey: 'name',
      header: ({ column }) => (
        <SortableHeader column={column}>Player</SortableHeader>
      ),
      cell: ({ row }) => {
        const player = row.original;
        return (
          <div className="flex min-w-[190px] flex-col leading-tight">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold">{player.name}</span>
              <SignalChip level={player.highlightLevel} />
            </div>
            <span className="mt-0.5 text-[11px] text-muted-foreground">
              {player.team}
              {player.isContractYear ? ' · Contract year' : ''}
            </span>
          </div>
        );
      },
    },
    {
      accessorKey: 'position',
      header: 'Pos',
      cell: ({ row }) => <PositionBadge position={row.getValue('position')} />,
      filterFn: (row, id, value: string[]) => {
        return value.includes(row.getValue(id));
      },
    },
    {
      accessorKey: 'byeWeek',
      header: ({ column }) => (
        <SortableHeader column={column}>Bye</SortableHeader>
      ),
      cell: ({ row }) => (
        <span className="font-mono text-sm text-muted-foreground">
          {row.getValue('byeWeek')}
        </span>
      ),
    },
    {
      accessorKey: 'valueScore',
      header: ({ column }) => <SortableHeader column={column}>Market</SortableHeader>,
      cell: ({ row }) => renderMarketDisplay(row.original),
    },
    {
      accessorKey: 'valueOverReplacement',
      header: ({ column }) => <SortableHeader column={column}>Value</SortableHeader>,
      cell: ({ row }) => renderValueDisplay(row.original),
    },
    {
      id: 'injuryRiskScore',
      accessorFn: (player) => Math.max(player.injuryRiskScore, player.uncertaintyScore),
      header: ({ column }) => <SortableHeader column={column}>Risk</SortableHeader>,
      cell: ({ row }) => renderRiskDisplay(row.original),
    },
  ];

  const baseColumns = options.advanced ? columns : compactColumns;

  return [
    ...baseColumns,
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const player = row.original;
        return (
          <div className="flex justify-end gap-1">
            {options.onInspect && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`View ${player.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  options.onInspect?.(player);
                }}
              >
                <Eye className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onDraft(player);
              }}
            >
              Draft
            </Button>
          </div>
        );
      },
      enableSorting: false,
      enableHiding: false,
    },
  ];
}
