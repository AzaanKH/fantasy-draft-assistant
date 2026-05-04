/**
 * Recommendations Component
 *
 * Displays player recommendations in two modes:
 * - Best Available: Pure ECR ranking
 * - By Need: Factoring in team needs and scarcity
 */

import * as React from 'react';
import type { Position, Recommendation } from '@fantasy-draft/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useRecommendations } from '@/hooks/useRecommendations';
import { usePlayerDataQuery } from '@/hooks/usePlayerData';
import { useDraftStore } from '@/stores/draftStore';
import { cn } from '@/lib/utils';

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

/**
 * Individual recommendation row
 */
function RecommendationRow({
  recommendation,
  rank,
  onDraft,
  showScore = false,
}: {
  recommendation: Recommendation;
  rank: number;
  onDraft?: (playerId: string) => void;
  showScore?: boolean;
}) {
  const handleClick = () => {
    if (onDraft) {
      onDraft(recommendation.playerId);
    }
  };

  return (
    <div
      className={cn(
        'flex items-center justify-between py-2 px-3 rounded-md transition-colors',
        rank === 1
          ? 'bg-green-500/10 border border-green-500/30'
          : 'bg-muted/30 hover:bg-muted/50',
        onDraft && 'cursor-pointer'
      )}
      onClick={handleClick}
    >
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground w-4">{rank}</span>
        <Badge
          variant="outline"
          className={cn('text-xs', positionColors[recommendation.position])}
        >
          {recommendation.position}
        </Badge>
        <div className="flex flex-col">
          <span className="text-sm font-medium">{recommendation.playerName}</span>
          <span className="text-xs text-muted-foreground">{recommendation.reason}</span>
        </div>
      </div>

      {showScore && (
        <span className="text-xs font-mono text-muted-foreground">
          {recommendation.score.toFixed(1)}
        </span>
      )}
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
  showScore = false,
}: {
  recommendations: readonly Recommendation[];
  emptyMessage: string;
  onDraft?: (playerId: string) => void;
  showScore?: boolean;
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
          showScore={showScore}
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

  return (
    <div
      className={cn(
        'p-3 rounded-lg bg-gradient-to-r from-green-500/20 to-green-500/5 border border-green-500/30',
        onDraft && 'cursor-pointer hover:from-green-500/30'
      )}
      onClick={() => onDraft?.(recommendation.playerId)}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-semibold text-green-600 uppercase">
          Top Pick
        </span>
        <Badge
          variant="outline"
          className={cn('text-xs', positionColors[recommendation.position])}
        >
          {recommendation.position}
        </Badge>
      </div>
      <div className="text-lg font-bold">{recommendation.playerName}</div>
      <div className="text-xs text-muted-foreground">{recommendation.reason}</div>
    </div>
  );
}

/**
 * Main Recommendations component
 */
export function Recommendations() {
  const { bestAvailable, byNeed, topPick, isLoading } = useRecommendations(5);
  const { players } = usePlayerDataQuery();
  const markPlayerDrafted = useDraftStore((state) => state.markPlayerDrafted);
  const addToMyRoster = useDraftStore((state) => state.addToMyRoster);
  const config = useDraftStore((state) => state.config);
  const currentPick = useDraftStore((state) => state.currentPick);

  // Calculate if it's user's turn
  const isMyTurn = React.useMemo(() => {
    const round = Math.ceil(currentPick / config.totalTeams);
    const pickInRound = ((currentPick - 1) % config.totalTeams) + 1;
    const isOddRound = round % 2 === 1;
    const positionThisRound = isOddRound
      ? pickInRound
      : config.totalTeams - pickInRound + 1;
    return positionThisRound === config.myPickPosition;
  }, [currentPick, config.totalTeams, config.myPickPosition]);

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

      const teamName = isMyTurn ? 'My Team' : `Team ${teamIndex + 1}`;

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
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Recommendations</CardTitle>
          {isMyTurn && (
            <Badge className="bg-green-500 text-white text-xs">Your Pick!</Badge>
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
        <Tabs defaultValue="by-need" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="by-need" className="text-xs">
              By Need
            </TabsTrigger>
            <TabsTrigger value="best-available" className="text-xs">
              Best Available
            </TabsTrigger>
          </TabsList>

          <TabsContent value="by-need" className="mt-2">
            <RecommendationList
              recommendations={byNeed}
              emptyMessage="No need-based recommendations"
              onDraft={isMyTurn ? handleDraft : undefined}
              showScore
            />
          </TabsContent>

          <TabsContent value="best-available" className="mt-2">
            <RecommendationList
              recommendations={bestAvailable}
              emptyMessage="No players available"
              onDraft={isMyTurn ? handleDraft : undefined}
            />
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
