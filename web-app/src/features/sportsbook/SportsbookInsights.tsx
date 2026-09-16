import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { usePlayerDataQuery } from '@/hooks/usePlayerData';
import { useDraftStore } from '@/stores/draftStore';
import {
  buildMilestoneWatchlist,
  DEFAULT_MILESTONE_ROW_LIMIT,
} from './milestone-watchlist';

function formatSnapshotDate(capturedAt: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(capturedAt));
}

export function SportsbookInsights(): React.ReactElement | null {
  const { players, sportsbookSnapshot, isLoading, isError } =
    usePlayerDataQuery();
  const draftedPlayerIds = useDraftStore((state) => state.draftedPlayerIds);
  const [showAll, setShowAll] = React.useState(false);

  const rows = React.useMemo(() => {
    if (!sportsbookSnapshot) return [];
    return buildMilestoneWatchlist(
      players,
      sportsbookSnapshot,
      draftedPlayerIds
    );
  }, [draftedPlayerIds, players, sportsbookSnapshot]);

  if (isLoading || isError || !sportsbookSnapshot || rows.length === 0) {
    return null;
  }

  const visibleRows = showAll
    ? rows
    : rows.slice(0, DEFAULT_MILESTONE_ROW_LIMIT);
  const hasMoreRows = rows.length > DEFAULT_MILESTONE_ROW_LIMIT;

  return (
    <Card className="gap-3 rounded-lg py-5">
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center justify-between gap-3 text-base">
          <span>DraftKings 1K+ Watchlist</span>
          <span className="shrink-0 text-xs font-normal text-muted-foreground">
            {rows.length} available
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Highest implied chances among undrafted players. Updates as picks and
          sportsbook snapshots change.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className={showAll ? 'max-h-[32rem] overflow-y-auto pr-1' : undefined}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Player</TableHead>
                <TableHead className="text-right">ECR</TableHead>
                <TableHead className="text-right">ADP</TableHead>
                <TableHead className="text-right">Chance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map(({ player, probability }) => (
                <TableRow key={player.id}>
                  <TableCell className="whitespace-normal font-medium leading-tight">
                    {player.name}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {player.ecrRank}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {player.consensusAdp ?? player.marketAdp}
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold tabular-nums">
                    {(probability * 100).toFixed(1)}%
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {hasMoreRows && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => { setShowAll((current) => !current); }}
          >
            {showAll
              ? `Show top ${String(DEFAULT_MILESTONE_ROW_LIMIT)}`
              : `Show all ${String(rows.length)}`}
          </Button>
        )}
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          Single-outcome milestone prices cannot be de-vigged without a
          complementary “No” market. Snapshot:{' '}
          {formatSnapshotDate(sportsbookSnapshot.metadata.capturedAt)}.
        </p>
      </CardContent>
    </Card>
  );
}
