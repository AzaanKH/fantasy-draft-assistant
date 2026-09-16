/**
 * Recommendations Component
 *
 * Displays player recommendations in four modes:
 * - Draft Now: Combined roster-aware ranking
 * - By Need: Factoring in team needs and scarcity
 * - Best Available: Composite player quality
 * - Best Value: Actionable consensus-ADP discounts above replacement level
 */

import * as React from 'react';
import type { Position, Recommendation } from '@fantasy-draft/shared';
import { CardListSkeleton } from '@/components/skeletons';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useRecommendations } from '@/hooks/useRecommendations';
import { usePlayerDataQuery } from '@/hooks/usePlayerData';
import {
  useDraftSessionMode,
  useDraftStore,
  useIsMyTurn,
} from '@/stores/draftStore';
import { cn, formatSignedNumber } from '@/lib/utils';
import { getKeeperAtPick } from '@/lib/mock-draft-engine';
import { getRecommendationExplanation } from './recommendation-explanation';

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

function formatTier(
  tier: number | undefined,
  remaining: number | undefined
): string {
  if (tier === undefined) return '-';
  return remaining === undefined
    ? `T${String(tier)}`
    : `T${String(tier)} · ${String(remaining)} left`;
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
  intentionalReach = false,
}: {
  recommendation: Recommendation;
  rank: number;
  onDraft?: (playerId: string) => void;
  intentionalReach?: boolean;
}) {
  const handleClick = () => {
    if (onDraft) {
      onDraft(recommendation.playerId);
    }
  };
  const projectedPoints = recommendation.diagnostics?.projectedPoints;
  const marketDelta = recommendation.diagnostics?.marketDelta;
  const marketReachCost = recommendation.diagnostics?.marketReachCost;
  const survivalProbability = recommendation.diagnostics?.nextPickSurvivalProbability;
  const vor = recommendation.diagnostics?.valueOverReplacement;
  const tier = recommendation.diagnostics?.tier;
  const tierRemaining = recommendation.diagnostics?.tierRemaining;
  const isLastInTier = recommendation.diagnostics?.isLastInTier ?? false;
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
              label={intentionalReach ? 'Custom value' : 'Above repl.'}
              value={typeof vor === 'number' ? formatSignedNumber(vor, 0) : '-'}
              tone="good"
            />
            <MetricPill
              label={intentionalReach ? 'Reach cost' : 'ECR vs ADP'}
              value={intentionalReach && typeof marketReachCost === 'number'
                ? `${marketReachCost.toFixed(1)} picks`
                : formatDelta(marketDelta)}
              tone={intentionalReach && typeof marketReachCost === 'number' && marketReachCost > 0
                ? 'warn'
                : marketTone}
            />
            <MetricPill
              label="Next pick"
              value={typeof survivalProbability === 'number'
                ? `${String(Math.round(survivalProbability * 100))}%`
                : '-'}
              tone={typeof survivalProbability === 'number' && survivalProbability < 0.4 ? 'warn' : 'neutral'}
            />
            <MetricPill
              label="Projected"
              value={typeof projectedPoints === 'number' ? projectedPoints.toFixed(0) : '-'}
            />
            <MetricPill
              label="Tier"
              value={`${intentionalReach ? 'RB ' : ''}${formatTier(tier, tierRemaining)}`}
              tone={isLastInTier ? 'warn' : 'neutral'}
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
  intentionalReach = false,
}: {
  recommendations: readonly Recommendation[];
  emptyMessage: string;
  onDraft?: (playerId: string) => void;
  intentionalReach?: boolean;
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
          intentionalReach={intentionalReach}
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
    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.09] p-4 dark:border-emerald-500/40 dark:bg-emerald-500/[0.14]">
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
      <p className="mt-2 text-sm leading-relaxed text-foreground/85">
        {getRecommendationExplanation(recommendation)}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Primary signal: {getPrimaryReason(recommendation.reason)}
      </p>
      {diagnostics && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <MetricPill
            label="Above repl."
            value={formatSignedNumber(diagnostics.valueOverReplacement, 0)}
            tone="good"
          />
          <MetricPill
            label="Projected"
            value={typeof projectedPoints === 'number' ? projectedPoints.toFixed(0) : '-'}
          />
          <MetricPill
            label="ECR vs ADP"
            value={formatDelta(marketDelta)}
            tone={marketTone}
          />
          <MetricPill
            label="Next pick"
            value={typeof survivalProbability === 'number'
              ? `${String(Math.round(survivalProbability * 100))}%`
              : '-'}
            tone={typeof survivalProbability === 'number' && survivalProbability < 0.4 ? 'warn' : 'neutral'}
          />
          <MetricPill
            label="Tier"
            value={formatTier(diagnostics.tier, diagnostics.tierRemaining)}
            tone={diagnostics.isLastInTier ? 'warn' : 'neutral'}
          />
          {diagnostics.isLastInTier && diagnostics.tierDropoffPoints !== undefined && (
            <MetricPill
              label="Cliff"
              value={`${diagnostics.tierDropoffPoints.toFixed(1)} pts`}
              tone="warn"
            />
          )}
          {diagnostics.leaguePositionTendency && (
            <span className="w-full pt-1 text-[11px] text-muted-foreground">
              {diagnostics.leaguePositionTendency}
            </span>
          )}
        </div>
      )}
      {onDraft && (
        <Button
          className="mt-4 w-full"
          onClick={() => {
            onDraft(recommendation.playerId);
          }}
        >
          Draft {recommendation.playerName}
        </Button>
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
    rbIntentionalReaches,
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
  const preloadedKeepers = useDraftStore((state) => state.preloadedKeepers);
  const sessionMode = useDraftSessionMode();
  const isMyTurn = useIsMyTurn();
  const keeperAtCurrentPick = sessionMode === 'mock'
    ? getKeeperAtPick(preloadedKeepers, currentPick, config.totalTeams)
    : undefined;
  const isActiveUserTurn = sessionMode !== 'setup' && isMyTurn && !keeperAtCurrentPick;

  // Handle drafting a player from recommendations
  const handleDraft = React.useCallback(
    (playerId: string) => {
      if (sessionMode === 'setup') return;
      const player = players.find((p) => p.id === playerId);
      if (!player) return;

      const teamIndex = (() => {
        const round = Math.ceil(currentPick / config.totalTeams);
        const pickInRound = ((currentPick - 1) % config.totalTeams) + 1;
        const isOddRound = round % 2 === 1;
        return isOddRound ? pickInRound - 1 : config.totalTeams - pickInRound;
      })();

      const teamName = isActiveUserTurn ? 'My Team' : `Team ${String(teamIndex + 1)}`;

      markPlayerDrafted(
        player.id,
        player.name,
        player.position,
        teamIndex,
        teamName
      );

      if (isActiveUserTurn) {
        addToMyRoster(player);
      }
    },
    [players, currentPick, config, sessionMode, isActiveUserTurn, markPlayerDrafted, addToMyRoster]
  );

  if (isLoading) {
    return <CardListSkeleton label="Loading recommendations" />;
  }

  return (
    <Card className="gap-4 rounded-lg py-5">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Recommendations</CardTitle>
          {isActiveUserTurn && (
            <Badge className="bg-green-500 text-white text-xs">Your Pick</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Top Pick Highlight */}
        <TopPickHighlight
          recommendation={topPick}
          onDraft={isActiveUserTurn ? handleDraft : undefined}
        />

        {/* Tabbed Recommendations */}
        <Tabs defaultValue="draft-now" className="w-full">
          <TabsList className="grid h-auto w-full grid-cols-3 gap-1 p-1">
            <TabsTrigger value="draft-now" className="min-h-8 px-1.5 text-[11px]">
              Draft Now
            </TabsTrigger>
            <TabsTrigger value="by-need" className="min-h-8 px-1.5 text-[11px]">
              By Need
            </TabsTrigger>
            <TabsTrigger value="rb-reach" className="min-h-8 px-1 text-[10px] leading-tight">
              Best RB / Reach
            </TabsTrigger>
            <TabsTrigger value="best-available" className="min-h-8 px-1.5 text-[11px]">
              Best Avail.
            </TabsTrigger>
            <TabsTrigger value="best-value" className="min-h-8 px-1.5 text-[11px]">
              Best Value
            </TabsTrigger>
          </TabsList>

          <TabsContent value="draft-now" className="mt-2">
            <RecommendationList
              recommendations={draftNow.slice(1)}
              emptyMessage="No alternate draft recommendations"
              onDraft={isActiveUserTurn ? handleDraft : undefined}
            />
          </TabsContent>

          <TabsContent value="by-need" className="mt-2">
            <div className="mb-2 text-[11px] text-muted-foreground">
              Urgent starter gaps only. Check Best Value for market steals.
            </div>
            <RecommendationList
              recommendations={byNeed}
              emptyMessage="No need-based recommendations"
              onDraft={isActiveUserTurn ? handleDraft : undefined}
            />
          </TabsContent>

          <TabsContent value="rb-reach" className="mt-2">
            <div className="mb-2 text-[11px] text-muted-foreground">
              Custom value above replacement, live RB tier supply, next-pick chance, and the picks paid ahead of ADP.
            </div>
            <RecommendationList
              recommendations={rbIntentionalReaches}
              emptyMessage="No legal running backs available"
              onDraft={isActiveUserTurn ? handleDraft : undefined}
              intentionalReach
            />
          </TabsContent>

          <TabsContent value="best-available" className="mt-2">
            <RecommendationList
              recommendations={bestAvailable}
              emptyMessage="No players available"
              onDraft={isActiveUserTurn ? handleDraft : undefined}
            />
          </TabsContent>

          <TabsContent value="best-value" className="mt-2">
            <div className="mb-2 text-[11px] text-muted-foreground">
              Draftable contributors with a meaningful consensus ADP discount.
            </div>
            <RecommendationList
              recommendations={marketValues}
              emptyMessage="No actionable market values available"
              onDraft={isActiveUserTurn ? handleDraft : undefined}
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
                      onDraft={isActiveUserTurn ? handleDraft : undefined}
                    />
                  </div>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {sessionMode === 'setup' ? (
          <div className="rounded-md border border-dashed px-3 py-2 text-center text-xs text-muted-foreground">
            Preview only · connect a live draft or start a mock to enable draft actions.
          </div>
        ) : !isMyTurn && (
          <div className="text-xs text-muted-foreground text-center">
            Recommendations will update as the board moves. Draft actions unlock on your turn.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
