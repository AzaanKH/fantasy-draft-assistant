/**
 * TeamNeeds Component
 *
 * Displays the user's positional needs based on:
 * - Current roster state
 * - Positional scarcity in the draft
 * - League roster requirements
 */

import type { Position, NeedPriority } from '@fantasy-draft/shared';
import { CardListSkeleton } from '@/components/skeletons';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useTeamNeeds } from '@/hooks/useTeamNeeds';
import { cn } from '@/lib/utils';

/**
 * Priority badge colors
 */
const priorityColors: Record<NeedPriority, string> = {
  critical: 'bg-red-500 text-white',
  high: 'bg-orange-500 text-white',
  medium: 'bg-yellow-500 text-black',
  low: 'bg-emerald-500/20 text-emerald-700 border-emerald-500',
  defer: 'bg-purple-500/10 text-purple-700 border-purple-500/40',
  filled: 'bg-green-500/20 text-green-700 border-green-500',
};

/**
 * Position colors for visual distinction
 */
const positionColors: Record<Position, string> = {
  QB: 'text-red-600',
  RB: 'text-green-600',
  WR: 'text-blue-600',
  TE: 'text-orange-600',
  K: 'text-purple-600',
  DEF: 'text-gray-600',
};

function formatPriority(priority: NeedPriority): string {
  if (priority === 'low') {
    return 'starter filled';
  }
  if (priority === 'filled') {
    return 'full';
  }
  return priority;
}

/**
 * Scarcity indicator bar - compact version
 */
function ScarcityBar({ score }: { score: number }) {
  const percentage = (score / 10) * 100;

  return (
    <div className="flex items-center gap-1.5 flex-1">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden min-w-[40px]">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            score >= 7 ? 'bg-red-500' : score >= 4 ? 'bg-yellow-500' : 'bg-green-500'
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="text-[10px] text-muted-foreground w-3">{score.toFixed(0)}</span>
    </div>
  );
}

/**
 * Individual need row - compact stacked layout
 */
function NeedRow({
  position,
  priority,
  startersFilled,
  startersNeeded,
  flexSlotsFilled,
  flexSlotsNeeded,
  isFlexEligible,
  scarcityScore,
}: {
  position: Position;
  priority: NeedPriority;
  startersFilled: number;
  startersNeeded: number;
  flexSlotsFilled: number;
  flexSlotsNeeded: number;
  isFlexEligible: boolean;
  scarcityScore: number;
}) {
  return (
    <div className="py-2 px-3 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors">
      {/* Top row: Position, Priority, Starters */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={cn('font-bold text-sm', positionColors[position])}>
            {position}
          </span>
          <Badge
            variant={priority === 'low' || priority === 'defer' || priority === 'filled' ? 'outline' : 'default'}
            className={cn('text-[10px] px-1.5 py-0', priorityColors[priority])}
          >
            {formatPriority(priority)}
          </Badge>
        </div>
        <span className="text-[11px] text-muted-foreground">
          {startersFilled}/{startersNeeded} fixed
          {isFlexEligible && flexSlotsNeeded > 0
            ? ` · ${String(flexSlotsFilled)}/${String(flexSlotsNeeded)} FLEX`
            : ''}
        </span>
      </div>

      {/* Bottom row: Scarcity bar */}
      <div className="flex items-center gap-2 mt-1.5">
        <span className="text-[10px] text-muted-foreground shrink-0">Scarcity</span>
        <ScarcityBar score={scarcityScore} />
      </div>
    </div>
  );
}

/**
 * Main TeamNeeds component
 */
export function TeamNeeds() {
  const { needs, criticalPositions, isLoading } = useTeamNeeds();

  if (isLoading) {
    return <CardListSkeleton label="Loading team needs" />;
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Team Needs</CardTitle>
          {criticalPositions.length > 0 && (
            <Badge variant="destructive" className="text-xs">
              {criticalPositions.length} urgent
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {needs.map((need) => (
          <NeedRow
            key={need.position}
            position={need.position}
            priority={need.priority}
            startersFilled={need.startersFilled}
            startersNeeded={need.startersNeeded}
            flexSlotsFilled={need.flexSlotsFilled}
            flexSlotsNeeded={need.flexSlotsNeeded}
            isFlexEligible={need.isFlexEligible}
            scarcityScore={need.scarcityScore}
          />
        ))}
      </CardContent>
    </Card>
  );
}
