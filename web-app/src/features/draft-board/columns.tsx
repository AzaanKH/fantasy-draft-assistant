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
import { ArrowUpDown, ArrowUp, ArrowDown, Eye, Star } from 'lucide-react';
import { cn, formatSignedNumber } from '@/lib/utils';
import {
  calculatePlayerRisk,
  type TierAvailability,
} from '@/lib/calculations';

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

function TierDisplay({
  player,
  availability,
}: {
  player: Player;
  availability?: TierAvailability;
}) {
  const isLastInTier = availability?.remaining === 1 &&
    availability.nextTier !== undefined &&
    availability.isMeaningfulCliff;
  const detail = availability
    ? isLastInTier
      ? 'Last available'
      : `${String(availability.remaining)} available`
    : player.tierSource === 'ecr-fallback'
      ? 'ECR fallback'
      : 'Projection tier';
  const cliffDetail = availability?.nextTier !== undefined &&
    availability.isMeaningfulCliff
    ? `${availability.dropoffPoints.toFixed(1)} pts to ${player.position} T${String(availability.nextTier)}`
    : undefined;

  return (
    <div className="flex min-w-[104px] flex-col leading-tight">
      <Badge
        variant="outline"
        className={cn(
          'w-fit font-mono text-xs',
          isLastInTier && 'border-amber-500/40 bg-amber-500/15 text-amber-800 dark:text-amber-300'
        )}
      >
        {player.position} T{player.tier}
      </Badge>
      <span
        className={cn(
          'mt-1 text-[11px] text-muted-foreground',
          isLastInTier && 'font-medium text-amber-700 dark:text-amber-300'
        )}
      >
        {detail}
      </span>
      {cliffDetail && (
        <span
          className={cn(
            'text-[10px] text-muted-foreground',
            isLastInTier && 'font-medium text-amber-700 dark:text-amber-300'
          )}
        >
          {cliffDetail}
        </span>
      )}
      {player.fantasyProsTier !== undefined && (
        <span className="text-[10px] text-muted-foreground">
          FantasyPros T{player.fantasyProsTier}
        </span>
      )}
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
      className: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/20 dark:text-emerald-300',
    },
    'good-value': {
      label: 'Good Value',
      className: 'border-amber-500/35 bg-amber-500/15 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/20 dark:text-amber-300',
    },
    neutral: {
      label: '',
      className: '',
    },
    avoid: {
      label: 'Avoid',
      className: 'border-red-500/35 bg-red-500/15 text-red-700 dark:border-red-500/40 dark:bg-red-500/20 dark:text-red-300',
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
      className: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/20 dark:text-emerald-300',
    },
    'good-value': {
      label: 'Value',
      className: 'border-amber-500/35 bg-amber-500/15 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/20 dark:text-amber-300',
    },
    neutral: {
      label: '',
      className: '',
    },
    avoid: {
      label: 'Caution',
      className: 'border-red-500/35 bg-red-500/15 text-red-700 dark:border-red-500/40 dark:bg-red-500/20 dark:text-red-300',
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
  const label = delta > 0 ? 'Later than ECR' : delta < 0 ? 'Earlier than ECR' : 'At ECR';

  return (
    <div className="flex flex-col">
      <ValueDisplay value={delta} />
      <span className="text-[11px] text-muted-foreground">
        ECR {player.ecrRank} · ADP {player.consensusAdp ?? player.marketAdp}
      </span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}

function SurvivalDisplay({ player }: { player: Player }) {
  const probability = Math.round(player.nextPickSurvivalProbability * 100);
  return (
    <div className="flex min-w-[78px] flex-col leading-tight">
      <span className={cn(
        'font-mono text-sm tabular-nums',
        probability < 40 ? 'font-semibold text-amber-700 dark:text-amber-300' : 'text-foreground'
      )}>
        {probability}%
      </span>
      <span className="text-[10px] text-muted-foreground">to your next pick</span>
    </div>
  );
}

function renderMarketDisplay(player: Player) {
  const delta = player.valueScore;
  const label = delta > 0 ? 'Later than ECR' : delta < 0 ? 'Earlier than ECR' : 'At ECR';

  return (
    <div className="flex min-w-[104px] flex-col leading-tight">
      <ValueDisplay value={delta} />
      <span className="text-[11px] text-muted-foreground">
        ECR {player.ecrRank} · ADP {player.consensusAdp ?? player.marketAdp}
      </span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}

function renderCompactProjectionDisplay(player: Player) {
  return (
    <div className="flex min-w-[104px] flex-col leading-tight">
      <span className="font-mono text-sm font-semibold tabular-nums">
        {player.projectedPoints.toFixed(1)}
      </span>
      <span className="text-[11px] text-muted-foreground">Projected pts</span>
      {player.marketAdjustment !== undefined && (
        <span className="text-[10px] text-muted-foreground">
          Sportsbook adjustment {formatSignedNumber(player.marketAdjustment, 1)}
        </span>
      )}
    </div>
  );
}

function renderCompactVorDisplay(player: Player) {
  return (
    <div className="flex min-w-[84px] flex-col leading-tight">
      <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
        {formatSignedNumber(player.valueOverReplacement, 1)}
      </span>
      <span className="text-[11px] text-muted-foreground">vs replacement</span>
    </div>
  );
}

function renderPredictionDisplay(player: Player) {
  const hasMarketAdjustment =
    player.marketAdjustment !== undefined &&
    player.sportsbookMarketCount !== undefined;

  return (
    <div className="flex flex-col">
      <span className="font-mono text-sm font-medium">
        {player.projectedPoints.toFixed(1)}
      </span>
      <span className="text-[11px] text-muted-foreground capitalize">
        {player.predictionSource}
      </span>
      {hasMarketAdjustment && (
        <span className="text-[11px] font-medium text-foreground">
          Sportsbook {formatSignedNumber(player.marketAdjustment ?? 0, 1)}
        </span>
      )}
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
  const risk = calculatePlayerRisk(player);
  const toneClass = {
    low: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    moderate: 'border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-300',
    high: 'border-orange-500/40 bg-orange-500/10 text-orange-800 dark:text-orange-300',
    'very-high': 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300',
  }[risk.level];

  return (
    <div className="flex min-w-[132px] flex-col items-start leading-tight">
      <div className="flex items-center gap-1.5">
        <Badge variant="outline" className={cn('h-5 px-1.5 text-[10px]', toneClass)}>
          {risk.label}
        </Badge>
        <span className="font-mono text-xs font-semibold tabular-nums">
          {risk.score.toFixed(1)}
        </span>
      </div>
      <span className="mt-1 text-[10px] text-muted-foreground">
        Availability {risk.availability.toFixed(1)} · Volatility {risk.volatility.toFixed(1)}
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
function getAdvancedColumns(
  getTierAvailability?: (player: Player) => TierAvailability | undefined
): ColumnDef<Player>[] {
  return [
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
    accessorKey: 'tier',
    header: ({ column }) => (
      <SortableHeader column={column}>Position tier</SortableHeader>
    ),
    cell: ({ row }) => (
      <TierDisplay
        player={row.original}
        availability={getTierAvailability?.(row.original)}
      />
    ),
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
    accessorKey: 'marketAdp',
    header: ({ column }) => (
      <SortableHeader column={column}>ADP</SortableHeader>
    ),
    cell: ({ row }) => (
      <span className="font-mono text-sm text-muted-foreground">
        {row.getValue('marketAdp')}
      </span>
    ),
  },
  {
    accessorKey: 'valueScore',
    header: ({ column }) => <SortableHeader column={column}>ECR vs ADP</SortableHeader>,
    cell: ({ row }) => <MarketDeltaDisplay player={row.original} />,
  },
  {
    accessorKey: 'projectedPoints',
    header: ({ column }) => <SortableHeader column={column}>Projection</SortableHeader>,
    cell: ({ row }) => renderPredictionDisplay(row.original),
  },
  {
    accessorKey: 'valueOverReplacement',
    header: ({ column }) => <SortableHeader column={column}>Above replacement</SortableHeader>,
    cell: ({ row }) => (
      <span className="font-mono text-sm">
        {formatSignedNumber(row.original.valueOverReplacement, 1)}
      </span>
    ),
  },
  {
    accessorKey: 'ceilingScore',
    header: ({ column }) => <SortableHeader column={column}>Range</SortableHeader>,
    cell: ({ row }) => renderRangeDisplay(row.original),
  },
  {
    accessorKey: 'nextPickSurvivalProbability',
    header: ({ column }) => <SortableHeader column={column}>Survival</SortableHeader>,
    cell: ({ row }) => <SurvivalDisplay player={row.original} />,
  },
  {
    id: 'injuryRiskScore',
    accessorFn: (player) => calculatePlayerRisk(player).score,
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
}

export const columns: ColumnDef<Player>[] = getAdvancedColumns();

/**
 * Column definitions with draft action button
 */
export function getColumnsWithActions(
  onDraft: (player: Player) => void,
  options: {
    advanced?: boolean;
    onInspect?: (player: Player) => void;
    onToggleShortlist?: (player: Player) => void;
    isShortlisted?: (player: Player) => boolean;
    isDrafted?: (player: Player) => boolean;
    canDraft?: boolean;
    getTierAvailability?: (player: Player) => TierAvailability | undefined;
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
      accessorKey: 'tier',
      header: ({ column }) => (
        <SortableHeader column={column}>Position tier</SortableHeader>
      ),
      cell: ({ row }) => (
        <TierDisplay
          player={row.original}
          availability={options.getTierAvailability?.(row.original)}
        />
      ),
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
      header: ({ column }) => <SortableHeader column={column}>Draft cost</SortableHeader>,
      cell: ({ row }) => renderMarketDisplay(row.original),
    },
    {
      accessorKey: 'projectedPoints',
      header: ({ column }) => <SortableHeader column={column}>Projection</SortableHeader>,
      cell: ({ row }) => renderCompactProjectionDisplay(row.original),
    },
    {
      accessorKey: 'valueOverReplacement',
      header: ({ column }) => <SortableHeader column={column}>Above replacement</SortableHeader>,
      cell: ({ row }) => renderCompactVorDisplay(row.original),
    },
    {
      accessorKey: 'nextPickSurvivalProbability',
      header: ({ column }) => <SortableHeader column={column}>Survival</SortableHeader>,
      cell: ({ row }) => <SurvivalDisplay player={row.original} />,
    },
    {
      id: 'injuryRiskScore',
      accessorFn: (player) => calculatePlayerRisk(player).score,
      header: ({ column }) => <SortableHeader column={column}>Risk</SortableHeader>,
      cell: ({ row }) => renderRiskDisplay(row.original),
    },
  ];

  const baseColumns = options.advanced
    ? getAdvancedColumns(options.getTierAvailability)
    : compactColumns;

  return [
    ...baseColumns,
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const player = row.original;
        const isShortlisted = options.isShortlisted?.(player) ?? false;
        const isDrafted = options.isDrafted?.(player) ?? false;
        return (
          <div className="flex justify-end gap-1">
            {options.onToggleShortlist && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`${isShortlisted ? 'Remove' : 'Add'} ${player.name} ${isShortlisted ? 'from' : 'to'} watchlist`}
                aria-pressed={isShortlisted}
                disabled={isDrafted}
                className={cn(isShortlisted && 'text-amber-500 hover:text-amber-600')}
                onClick={(e) => {
                  e.stopPropagation();
                  options.onToggleShortlist?.(player);
                }}
              >
                <Star className={cn('h-4 w-4', isShortlisted && 'fill-current')} />
              </Button>
            )}
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
              disabled={isDrafted || options.canDraft === false}
              title={
                options.canDraft === false
                  ? 'Connect a live draft or start a mock draft to record picks.'
                  : undefined
              }
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
