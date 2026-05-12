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
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';

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

/**
 * Highlight badge with color-coded background
 */
function HighlightBadge({ level }: { level: HighlightLevel }) {
  const config: Record<HighlightLevel, { label: string; className: string }> = {
    'strong-buy': {
      label: 'Strong Buy',
      className: 'bg-green-500 text-white border-green-600',
    },
    'good-value': {
      label: 'Good Value',
      className: 'bg-yellow-500 text-black border-yellow-600',
    },
    neutral: {
      label: '',
      className: '',
    },
    avoid: {
      label: 'Avoid',
      className: 'bg-red-500 text-white border-red-600',
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

/**
 * Value score display with positive/negative coloring
 */
function ValueDisplay({ value }: { value: number }) {
  const className = cn(
    'font-mono text-sm',
    value >= 10 && 'text-green-600 dark:text-green-400 font-bold',
    value >= 5 && value < 10 && 'text-green-500 dark:text-green-500',
    value <= -15 && 'text-red-600 dark:text-red-400 font-bold',
    value < -5 && value > -15 && 'text-red-500 dark:text-red-500',
    value >= -5 && value < 5 && 'text-muted-foreground'
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
      onClick={() => column.toggleSorting(sorted === 'asc')}
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
  onDraft: (player: Player) => void
): ColumnDef<Player>[] {
  return [
    ...columns,
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const player = row.original;
        return (
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
        );
      },
      enableSorting: false,
      enableHiding: false,
    },
  ];
}
