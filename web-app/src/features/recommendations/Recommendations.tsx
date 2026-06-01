/**
 * Recommendations Component
 *
 * Displays player recommendations in four modes:
 * - Draft Now: Combined roster-aware ranking
 * - By Need: Factoring in team needs and scarcity
 * - Best Available: Composite player quality
 * - Best Value: Actionable Sleeper market discounts above replacement level
 */

import * as React from 'react';
import type { Position, Recommendation } from '@fantasy-draft/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useRecommendations } from '@/hooks/useRecommendations';
import { usePlayerDataQuery } from '@/hooks/usePlayerData';
import { useDraftStore, useIsMyTurn } from '@/stores/draftStore';
import { cn, formatSignedNumber } from '@/lib/utils';

/**
 * Position colors for badges
 */
const positionColors: Record<Position, string> = {
  QB: 'bg-red-500/20 text-red-700 border-red-500',
  RB: 'bg-green-500/20 text-green-700 border-green-500',
  WR: 'bg-blue-500/20 text-blue-700 border-blue-500',
  TE: 'bg-orange-500/20 text-orange-700 border-orange-500',
  K: 'bg-purple-500/20 text-purple-700 border-purple-500',
  DEF: 'bg-gray-500/20 text-gray-700 border-gray-500',
};

function formatDelta(value: number | undefined): string {
  if (typeof value !== 'number') return '-';
  return formatSignedNumber(value);
}

function getPrimaryReason(reason: string): string {
  return reason.split(' · ')[0] ?? reason;
}

function MetricPill({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
}) {
  const toneClass = {
    neutral: 'border-border bg-muted/30 text-muted-foreground',
    good: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/20 dark:text-emerald-300',
    warn: 'border-amber-500/35 bg-amber-500/15 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/20 dark:text-amber-300',
    bad: 'border-red-500/35 bg-red-500/15 text-red-700 dark:border-red-500/40 dark:bg-red-500/20 dark:text-red-300',
  }[tone];

  return (
    <span className={cn('rounded-md border px-2 py-1 text-[11px]', toneClass)}>
      <span className="text-muted-foreground">{label}</span>{' '}
      <span className="font-mono font-semibold tabular-nums">{value}</span>
    </span>
  );
}

function getRecommendationTone(
  marketDelta: number | undefined,
  survivalProbability: number | undefined
): 'neutral' | 'good' | 'warn' | 'bad' {
  if (typeof marketDelta === 'number' && marketDelta <= -6) {
    return 'bad';
  }
  if (typeof survivalProbability === 'number' && survivalProbability < 0.4) {
    return 'warn';
  }
  if (typeof marketDelta === 'number' && marketDelta > 0) {
    return 'good';
  }
  return 'neutral';
}

function getRecommendationSurface(tone: 'neutral' | 'good' | 'warn' | 'bad'): string {
  return {
    neutral: 'border-transparent bg-muted/25 hover:bg-muted/40',
    good:
      'border-emerald-500/25 bg-emerald-500/[0.08] hover:bg-emerald-500/[0.12] dark:border-emerald-500/40 dark:bg-emerald-500/[0.14] dark:hover:bg-emerald-500/[0.18]',
    warn:
      'border-amber-500/25 bg-amber-500/[0.08] hover:bg-amber-500/[0.12] dark:border-amber-500/40 dark:bg-amber-500/[0.14] dark:hover:bg-amber-500/[0.18]',
    bad:
      'border-red-500/25 bg-red-500/[0.08] hover:bg-red-500/[0.12] dark:border-red-500/40 dark:bg-red-500/[0.14] dark:hover:bg-red-500/[0.18]',
  }[tone];
}

/**
 * Individual recommendation row
 */
function RecommendationRow({
  recommendation,
  rank,
  onDraft,
}: {
  recommendation: Recommendation;
  rank: number;
  onDraft?: (playerId: string) => void;
}) {
  const handleClick = () => {
    if (onDraft) {
      onDraft(recommendation.playerId);
    }
  };
  const projectedPoints = recommendation.diagnostics?.projectedPoints;
  const marketDelta = recommendation.diagnostics?.marketDelta;
  const survivalProbability = recommendation.diagnostics?.nextPickSurvivalProbability;
  const vor = recommendation.diagnostics?.valueOverReplacement;
  const marketTone = typeof marketDelta === 'number' && marketDelta > 0
    ? 'good'
    : typeof marketDelta === 'number' && marketDelta < -5
      ? 'bad'
      : 'neutral';
  const rowTone = getRecommendationTone(marketDelta, survivalProbability);

  return (
    <div
      className={cn(
        'rounded-md border px-3 py-3 transition-colors',
        getRecommendationSurface(rowTone),
        onDraft && 'cursor-pointer'
      )}
      onClick={handleClick}
    >
      <div className="flex items-start gap-3">
        <span className="mt-1 w-4 text-xs text-muted-foreground">{rank}</span>
        <Badge
          variant="outline"
          className={cn('mt-0.5 text-xs', positionColors[recommendation.position])}
        >
          {recommendation.position}
        </Badge>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <span className="text-sm font-semibold leading-tight">{recommendation.playerName}</span>
            {onDraft && (
              <Button
                size="sm"
                variant={rank === 1 ? 'default' : 'outline'}
                className="h-7 px-2 text-xs"
                onClick={(event) => {
                  event.stopPropagation();
                  handleClick();
                }}
              >
                Draft
              </Button>
            )}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {getPrimaryReason(recommendation.reason)}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <MetricPill
              label="VOR"
              value={typeof vor === 'number' ? formatSignedNumber(vor, 0) : '-'}
              tone="good"
            />
            <MetricPill
              label="Market"
              value={formatDelta(marketDelta)}
              tone={marketTone}
            />
            <MetricPill
              label="Wait"
              value={typeof survivalProbability === 'number'
                ? `${String(Math.round(survivalProbability * 100))}%`
                : '-'}
              tone={typeof survivalProbability === 'number' && survivalProbability < 0.4 ? 'warn' : 'neutral'}
            />
            <MetricPill
              label="Proj"
              value={typeof projectedPoints === 'number' ? projectedPoints.toFixed(0) : '-'}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Recommendation list component
 */
function RecommendationList({
  recommendations,
  emptyMessage,
  onDraft,
}: {
  recommendations: readonly Recommendation[];
  emptyMessage: string;
  onDraft?: (playerId: string) => void;
}) {
  if (recommendations.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-4">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {recommendations.map((rec, index) => (
        <RecommendationRow
          key={rec.playerId}
          recommendation={rec}
          rank={index + 1}
          onDraft={onDraft}
        />
      ))}
    </div>
  );
}

/**
 * Top pick highlight component
 */
function TopPickHighlight({
  recommendation,
  onDraft,
}: {
  recommendation: Recommendation | null;
  onDraft?: (playerId: string) => void;
}) {
  if (!recommendation) {
    return null;
  }

  const projectedPoints = recommendation.diagnostics?.projectedPoints;
  const survivalProbability = recommendation.diagnostics?.nextPickSurvivalProbability;
  const diagnostics = recommendation.diagnostics;
  const marketDelta = diagnostics?.marketDelta;
  const marketTone = typeof marketDelta === 'number' && marketDelta > 0
    ? 'good'
    : typeof marketDelta === 'number' && marketDelta < -5
      ? 'bad'
      : 'neutral';

  return (
    <div
      className={cn(
        'rounded-lg border border-emerald-500/30 bg-emerald-500/[0.09] p-4 dark:border-emerald-500/40 dark:bg-emerald-500/[0.14]',
        onDraft && 'cursor-pointer hover:bg-emerald-500/[0.13] dark:hover:bg-emerald-500/[0.18]'
      )}
      onClick={() => onDraft?.(recommendation.playerId)}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-semibold uppercase text-emerald-700 dark:text-emerald-300">
          Top Pick
        </span>
        <Badge
          variant="outline"
          className={cn('text-xs', positionColors[recommendation.position])}
        >
          {recommendation.position}
        </Badge>
      </div>
      <div className="text-xl font-bold leading-tight">{recommendation.playerName}</div>
      <div className="mt-1 text-xs text-muted-foreground">
        {getPrimaryReason(recommendation.reason)}
      </div>
      {diagnostics && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <MetricPill
            label="VOR"
            value={formatSignedNumber(diagnostics.valueOverReplacement, 0)}
            tone="good"
          />
          <MetricPill
            label="Proj"
            value={typeof projectedPoints === 'number' ? projectedPoints.toFixed(0) : '-'}
          />
          <MetricPill
            label="Market"
            value={formatDelta(marketDelta)}
            tone={marketTone}
          />
          <MetricPill
            label="Wait"
            value={typeof survivalProbability === 'number'
              ? `${String(Math.round(survivalProbability * 100))}%`
              : '-'}
            tone={typeof survivalProbability === 'number' && survivalProbability < 0.4 ? 'warn' : 'neutral'}
          />
          <MetricPill label="Tier" value={String(diagnostics.tier)} />
          {diagnostics.leaguePositionTendency && (
            <span className="w-full pt-1 text-[11px] text-muted-foreground">
              {diagnostics.leaguePositionTendency}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Main Recommendations component
 */
export function Recommendations(): React.ReactElement {
  const {
    draftNow,
    bestAvailable,
    marketValues,
    marketStashes,
    byNeed,
    topPick,
    isLoading,
  } = useRecommendations(5);
  const [showMarketStashes, setShowMarketStashes] = React.useState(false);
  const { players } = usePlayerDataQuery();
  const markPlayerDrafted = useDraftStore((state) => state.markPlayerDrafted);
  const addToMyRoster = useDraftStore((state) => state.addToMyRoster);
  const config = useDraftStore((state) => state.config);
  const currentPick = useDraftStore((state) => state.currentPick);
  const isMyTurn = useIsMyTurn();

  // Handle drafting a player from recommendations
  const handleDraft = React.useCallback(
    (playerId: string) => {
      const player = players.find((p) => p.id === playerId);
      if (!player) return;

      const teamIndex = (() => {
        const round = Math.ceil(currentPick / config.totalTeams);
        const pickInRound = ((currentPick - 1) % config.totalTeams) + 1;
        const isOddRound = round % 2 === 1;
        return isOddRound ? pickInRound - 1 : config.totalTeams - pickInRound;
      })();

      const teamName = isMyTurn ? 'My Team' : `Team ${String(teamIndex + 1)}`;

      markPlayerDrafted(
        player.id,
        player.name,
        player.position,
        teamIndex,
        teamName
      );

      if (isMyTurn) {
        addToMyRoster(player);
      }
    },
    [players, currentPick, config, isMyTurn, markPlayerDrafted, addToMyRoster]
  );

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Recommendations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Loading...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="gap-4 rounded-lg py-5">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Recommendations</CardTitle>
          {isMyTurn && (
            <Badge className="bg-green-500 text-white text-xs">Your Pick</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Top Pick Highlight */}
        <TopPickHighlight
          recommendation={topPick}
          onDraft={isMyTurn ? handleDraft : undefined}
        />

        {/* Tabbed Recommendations */}
        <Tabs defaultValue="draft-now" className="w-full">
          <TabsList className="grid h-auto w-full grid-cols-4 p-1">
            <TabsTrigger value="draft-now" className="px-1.5 text-[11px]">
              Draft Now
            </TabsTrigger>
            <TabsTrigger value="by-need" className="px-1.5 text-[11px]">
              By Need
            </TabsTrigger>
            <TabsTrigger value="best-available" className="px-1.5 text-[11px]">
              Best Avail.
            </TabsTrigger>
            <TabsTrigger value="best-value" className="px-1.5 text-[11px]">
              Best Value
            </TabsTrigger>
          </TabsList>

          <TabsContent value="draft-now" className="mt-2">
            <RecommendationList
              recommendations={draftNow.slice(1)}
              emptyMessage="No alternate draft recommendations"
              onDraft={isMyTurn ? handleDraft : undefined}
            />
          </TabsContent>

          <TabsContent value="by-need" className="mt-2">
            <div className="mb-2 text-[11px] text-muted-foreground">
              Urgent starter gaps only. Check Best Value for market steals.
            </div>
            <RecommendationList
              recommendations={byNeed}
              emptyMessage="No need-based recommendations"
              onDraft={isMyTurn ? handleDraft : undefined}
            />
          </TabsContent>

          <TabsContent value="best-available" className="mt-2">
            <RecommendationList
              recommendations={bestAvailable}
              emptyMessage="No players available"
              onDraft={isMyTurn ? handleDraft : undefined}
            />
          </TabsContent>

          <TabsContent value="best-value" className="mt-2">
            <div className="mb-2 text-[11px] text-muted-foreground">
              Draftable contributors with a meaningful Sleeper discount.
            </div>
            <RecommendationList
              recommendations={marketValues}
              emptyMessage="No actionable market values available"
              onDraft={isMyTurn ? handleDraft : undefined}
            />
            {marketStashes.length > 0 && (
              <div className="mt-3 border-t pt-3">
                <label className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                  <span>Show late-round stashes ({marketStashes.length})</span>
                  <Switch
                    checked={showMarketStashes}
                    onCheckedChange={setShowMarketStashes}
                    aria-label="Show late-round stashes"
                  />
                </label>
                {showMarketStashes && (
                  <div className="mt-2">
                    <RecommendationList
                      recommendations={marketStashes}
                      emptyMessage="No late-round stashes available"
                      onDraft={isMyTurn ? handleDraft : undefined}
                    />
                  </div>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {!isMyTurn && (
          <div className="text-xs text-muted-foreground text-center">
            Click to mark as drafted when it's your pick
          </div>
        )}
      </CardContent>
    </Card>
  );
}
