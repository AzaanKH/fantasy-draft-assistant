/**
 * PlayerTable Component
 *
 * Full-featured player table with:
 * - Position filtering (QB, RB, WR, TE, K, DEF, FLEX)
 * - Search by name
 * - Toggle to show/hide drafted players
 * - Sortable columns
 * - Color-coded highlight badges
 * - Click row or button to draft player
 * - Draft simulation controls for testing
 */

import * as React from 'react';
import type { Player, Position, HighlightLevel } from '@fantasy-draft/shared';
import { POSITIONS } from '@fantasy-draft/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DataTable } from './data-table';
import { getColumnsWithActions } from './columns';
import { DraftConnect } from './DraftConnect';
import { OnTheClock } from './OnTheClock';
import { ShortlistQueue } from './ShortlistQueue';
import { MockDraftControls } from './MockDraftControls';
import { MyRoster } from '@/features/my-roster';
import { usePlayerDataQuery, usePositionStats } from '@/hooks/usePlayerData';
import {
  useKeeperPreload,
  type KeeperPreloadStatus,
} from '@/hooks/useKeeperPreload';
import {
  useDraftSessionMode,
  useDraftStore,
  useIsMyTurn,
} from '@/stores/draftStore';
import { cn, formatSignedNumber } from '@/lib/utils';
import {
  calculatePlayerRisk,
  calculateTierAvailability,
  getTierKey,
  type TierAvailability,
} from '@/lib/calculations';
import { getKeeperAtPick } from '@/lib/mock-draft-engine';
import { useDraftDecision } from '@/features/recommendations/DraftDecisionContext';

/** Position filter type including FLEX */
type PositionFilter = Position | 'ALL' | 'FLEX';

/** FLEX eligible positions */
const FLEX_POSITIONS: Position[] = ['RB', 'WR', 'TE'];
const ECR_SORTING = [{ id: 'ecrRank', desc: false }];
const TIER_SORTING = [
  { id: 'tier', desc: false },
  { id: 'valueOverReplacement', desc: true },
];

/**
 * Position filter button group with FLEX option
 */
function PositionFilters({
  selected,
  onSelect,
}: {
  selected: PositionFilter;
  onSelect: (position: PositionFilter) => void;
}) {
  // ALL, then FLEX, then individual positions
  const filters: PositionFilter[] = ['ALL', 'FLEX', ...POSITIONS];

  const colors: Record<PositionFilter, string> = {
    ALL: '',
    FLEX: 'data-[state=on]:bg-indigo-500/20 data-[state=on]:text-indigo-700 data-[state=on]:border-indigo-500',
    QB: 'data-[state=on]:bg-red-500/20 data-[state=on]:text-red-700 data-[state=on]:border-red-500',
    RB: 'data-[state=on]:bg-green-500/20 data-[state=on]:text-green-700 data-[state=on]:border-green-500',
    WR: 'data-[state=on]:bg-blue-500/20 data-[state=on]:text-blue-700 data-[state=on]:border-blue-500',
    TE: 'data-[state=on]:bg-orange-500/20 data-[state=on]:text-orange-700 data-[state=on]:border-orange-500',
    K: 'data-[state=on]:bg-purple-500/20 data-[state=on]:text-purple-700 data-[state=on]:border-purple-500',
    DEF: 'data-[state=on]:bg-gray-500/20 data-[state=on]:text-gray-700 data-[state=on]:border-gray-500',
  };

  return (
    <div className="flex flex-wrap gap-1">
      {filters.map((pos) => (
        <Button
          key={pos}
          variant={selected === pos ? 'default' : 'outline'}
          size="sm"
          data-state={selected === pos ? 'on' : 'off'}
          aria-pressed={selected === pos}
          aria-label={`Filter players by ${pos === 'ALL' ? 'all positions' : pos}`}
          className={cn(
            'min-w-12 transition-colors',
            selected === pos && colors[pos]
          )}
          onClick={() => { onSelect(pos); }}
        >
          {pos}
        </Button>
      ))}
    </div>
  );
}

function KeeperPoolStatus({ status }: { status: KeeperPreloadStatus }): React.ReactElement {
  const isBlocked = !status.isMockReady;
  const message = status.isLoading
    ? 'Loading keepers before mock simulation…'
    : status.isError
      ? 'Keeper preload failed. Mock simulation is locked until the keeper file loads.'
      : status.duplicateNames.length > 0
        ? `Duplicate keepers: ${status.duplicateNames.join(', ')}. Keep each player once.`
        : status.invalidAssignments.length > 0
          ? `Invalid keeper slots: ${status.invalidAssignments.join('; ')}.`
          : status.unresolvedNames.length > 0
            ? `Unresolved keepers: ${status.unresolvedNames.join(', ')}. Fix their IDs or names before mocking.`
            : !status.isConfirmed
              ? `Keeper pool unconfirmed: ${String(status.configuredCount)} keepers in current-keepers.json. Add the final list and updatedAt before mocking.`
              : !status.isInitialized
                ? `Waiting for all ${String(status.configuredCount)} keepers to load into the draft.`
                : `${String(status.canonicalCount)} keepers reserved for their assigned team and round.`;

  return (
    <div
      className={cn(
        'rounded-md border px-3 py-2 text-xs',
        isBlocked
          ? 'border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-300'
          : 'border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-800 dark:text-emerald-300'
      )}
      role={isBlocked ? 'alert' : 'status'}
    >
      <span className="font-semibold">Keeper pool:</span>{' '}
      {message}
    </div>
  );
}

/**
 * Stats bar showing player counts by position
 */
function PositionStats() {
  const stats = usePositionStats();

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {POSITIONS.map((pos) => (
        <span key={pos} className="tabular-nums">
          {pos}: {stats[pos].available}/{stats[pos].total}
        </span>
      ))}
    </div>
  );
}

/**
 * Row highlight styling based on player value
 */
function getRowHighlightClass(player: Player): string {
  const classes: Record<HighlightLevel, string> = {
    'strong-buy':
      'bg-emerald-500/[0.08] hover:bg-emerald-500/[0.12] dark:bg-emerald-500/[0.14] dark:hover:bg-emerald-500/[0.18]',
    'good-value':
      'bg-amber-500/[0.08] hover:bg-amber-500/[0.12] dark:bg-amber-500/[0.14] dark:hover:bg-amber-500/[0.18]',
    neutral: 'hover:bg-muted/35',
    avoid:
      'bg-red-500/[0.08] hover:bg-red-500/[0.12] dark:bg-red-500/[0.14] dark:hover:bg-red-500/[0.18]',
  };
  return classes[player.highlightLevel];
}

function MetricTile({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
}) {
  const toneClass = {
    neutral: 'border-border bg-muted/25',
    good: 'border-foreground/25 bg-muted/35 text-foreground',
    warn: 'border-muted-foreground/30 bg-muted/30 text-foreground',
    bad: 'border-muted-foreground/35 bg-muted/25 text-foreground',
  }[tone];

  return (
    <div className={cn('rounded-md border px-3 py-2', toneClass)}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-mono text-sm font-semibold tabular-nums">{value}</div>
      {detail && <div className="mt-0.5 text-[11px] text-muted-foreground">{detail}</div>}
    </div>
  );
}

function PlayerDetailDialog({
  player,
  isDrafted,
  tierAvailability,
  open,
  onOpenChange,
  onDraft,
  canDraft,
}: {
  player: Player | null;
  isDrafted: boolean;
  tierAvailability?: TierAvailability;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDraft: (player: Player) => void;
  canDraft: boolean;
}) {
  if (!player) {
    return null;
  }

  const marketTone = player.valueScore > 0 ? 'good' : player.valueScore < -5 ? 'bad' : 'neutral';
  const risk = calculatePlayerRisk(player);
  const riskTone = risk.level === 'very-high'
    ? 'bad'
    : risk.level === 'high' || risk.level === 'moderate'
      ? 'warn'
      : 'neutral';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {player.name}
            <Badge variant="outline">{player.position}</Badge>
            <span className="text-sm font-normal text-muted-foreground">{player.team}</span>
          </DialogTitle>
          <DialogDescription>
            Projection quality, replacement value, market cost, and risk for this pick.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricTile
            label="Above replacement"
            value={formatSignedNumber(player.valueOverReplacement, 1)}
            detail="vs replacement"
            tone="good"
          />
          <MetricTile
            label="Projection"
            value={player.projectedPoints.toFixed(1)}
            detail={
              player.marketAdjustment === undefined
                ? player.predictionSource
                : `${player.preMarketProjectedPoints?.toFixed(1) ?? '—'} base · market ${formatSignedNumber(player.marketAdjustment, 1)}`
            }
          />
          <MetricTile
            label="ECR vs ADP"
            value={`${player.valueScore > 0 ? '+' : ''}${player.valueScore}`}
            detail={`FP ${player.ecrRank} / SL ${player.marketRank}`}
            tone={marketTone}
          />
          <MetricTile
            label="Next-pick chance"
            value={`${Math.round(player.nextPickSurvivalProbability * 100)}%`}
            detail="to next pick"
            tone={player.nextPickSurvivalProbability < 0.4 ? 'warn' : 'neutral'}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <MetricTile
            label="Range"
            value={`${player.floorScore.toFixed(1)} / ${player.ceilingScore.toFixed(1)}`}
            detail="floor / ceiling"
          />
          <MetricTile
            label="Risk"
            value={`${risk.label} · ${risk.score.toFixed(1)}`}
            detail={`availability ${risk.availability.toFixed(1)} · volatility ${risk.volatility.toFixed(1)}`}
            tone={riskTone}
          />
          <MetricTile
            label="Position tier"
            value={`${player.position} T${String(player.tier)}`}
            detail={[
              tierAvailability
                ? `${String(tierAvailability.remaining)} available`
                : undefined,
              tierAvailability?.nextTier !== undefined
                ? `${tierAvailability.dropoffPoints.toFixed(1)} point ${tierAvailability.isMeaningfulCliff ? 'cliff' : 'gap'}`
                : undefined,
              player.fantasyProsTier !== undefined
                ? `FantasyPros T${String(player.fantasyProsTier)}`
                : undefined,
              player.tierSource === 'ecr-fallback'
                ? 'ECR fallback'
                : 'projection-cliff tier',
            ].filter((detail): detail is string => detail !== undefined).join(' · ')}
            tone={
              tierAvailability?.remaining === 1 && tierAvailability.isMeaningfulCliff
                ? 'warn'
                : 'neutral'
            }
          />
        </div>

        <div className="flex justify-end">
          <Button
            disabled={isDrafted || !canDraft}
            onClick={() => {
              if (isDrafted) return;
              onDraft(player);
              onOpenChange(false);
            }}
          >
            {isDrafted
              ? 'Already drafted'
              : canDraft
                ? `Draft ${player.name}`
                : 'Start a draft to record this pick'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function getMobilePlayerSummary(
  player: Player,
  availability: TierAvailability | undefined
): string {
  const tierSummary = availability?.remaining === 1
    ? `Last available player in ${player.position} Tier ${String(player.tier)}`
    : availability
      ? `${String(availability.remaining)} players remain in ${player.position} Tier ${String(player.tier)}`
      : `${player.position} Tier ${String(player.tier)}`;
  const marketSummary = player.valueScore > 0
    ? `usually drafted ${String(player.valueScore)} picks later than expert rank`
    : player.valueScore < 0
      ? `usually drafted ${String(Math.abs(player.valueScore))} picks earlier than expert rank`
      : 'usually drafted at expert rank';

  return `${tierSummary}; ${formatSignedNumber(player.valueOverReplacement, 1)} projected points above replacement; ${marketSummary}.`;
}

function MobilePlayerCards({
  players,
  canDraft,
  onDraft,
  onInspect,
  onToggleShortlist,
  isShortlisted,
  isDrafted,
  getTierAvailability,
}: {
  players: readonly Player[];
  canDraft: boolean;
  onDraft: (player: Player) => void;
  onInspect: (player: Player) => void;
  onToggleShortlist: (player: Player) => void;
  isShortlisted: (player: Player) => boolean;
  isDrafted: (player: Player) => boolean;
  getTierAvailability: (player: Player) => TierAvailability | undefined;
}): React.ReactElement {
  const pageSize = 15;
  const [pageIndex, setPageIndex] = React.useState(0);
  const pageCount = Math.max(1, Math.ceil(players.length / pageSize));

  React.useEffect(() => {
    setPageIndex(0);
  }, [players]);

  const visiblePlayers = players.slice(
    pageIndex * pageSize,
    (pageIndex + 1) * pageSize
  );

  return (
    <section aria-label="Available player cards" className="space-y-3 md:hidden">
      <div className="space-y-2" aria-live="polite">
        {visiblePlayers.map((player) => {
          const shortlisted = isShortlisted(player);
          const drafted = isDrafted(player);
          const availability = getTierAvailability(player);

          return (
            <article
              key={player.id}
              className={cn(
                'rounded-lg border border-border/80 bg-card p-4 shadow-xs',
                shortlisted && 'ring-1 ring-amber-400/50',
                drafted && 'opacity-50'
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">
                      #{String(player.ecrRank)}
                    </span>
                    <Badge variant="outline">{player.position}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {player.team} · bye {String(player.byeWeek)}
                    </span>
                  </div>
                  <h3 className="mt-2 text-base font-semibold">{player.name}</h3>
                </div>
                {player.highlightLevel !== 'neutral' && (
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {player.highlightLevel === 'strong-buy'
                      ? 'Strong value'
                      : player.highlightLevel === 'good-value'
                        ? 'Value'
                        : 'Caution'}
                  </Badge>
                )}
              </div>

              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {getMobilePlayerSummary(player, availability)}
              </p>

              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div className="rounded-md bg-muted/35 px-2 py-1.5">
                  <span className="text-muted-foreground">Projected points</span>{' '}
                  <span className="font-mono font-semibold tabular-nums">
                    {player.projectedPoints.toFixed(1)}
                  </span>
                </div>
                <div className="rounded-md bg-muted/35 px-2 py-1.5">
                  <span className="text-muted-foreground">Survival</span>{' '}
                  <span className="font-mono font-semibold tabular-nums">
                    {String(Math.round(player.nextPickSurvivalProbability * 100))}%
                  </span>
                </div>
                <div className="rounded-md bg-muted/35 px-2 py-1.5">
                  <span className="text-muted-foreground">ECR / ADP</span>{' '}
                  <span className="font-mono font-semibold tabular-nums">
                    {String(player.ecrRank)} / {String(player.consensusAdp ?? player.marketAdp)}
                  </span>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-pressed={shortlisted}
                  onClick={() => {
                    onToggleShortlist(player);
                  }}
                >
                  {shortlisted ? 'Watching' : 'Watch'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onInspect(player);
                  }}
                >
                  Details
                </Button>
                <Button
                  size="sm"
                  disabled={drafted || !canDraft}
                  title={
                    !canDraft
                      ? 'Connect a live draft or start a mock draft to record picks.'
                      : undefined
                  }
                  onClick={() => {
                    onDraft(player);
                  }}
                >
                  Draft
                </Button>
              </div>
            </article>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3 py-2">
        <Button
          variant="outline"
          size="sm"
          disabled={pageIndex === 0}
          onClick={() => {
            setPageIndex((current) => Math.max(0, current - 1));
          }}
        >
          Previous
        </Button>
        <span className="text-xs text-muted-foreground">
          Page {String(pageIndex + 1)} of {String(pageCount)} · {String(players.length)} players
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={pageIndex + 1 >= pageCount}
          onClick={() => {
            setPageIndex((current) => Math.min(pageCount - 1, current + 1));
          }}
        >
          Next
        </Button>
      </div>
    </section>
  );
}

/**
 * Main PlayerTable component
 */
export function PlayerTable() {
  const { players: basePlayers, isLoading, isError, error, dataInfo } =
    usePlayerDataQuery();
  const keeperStatus = useKeeperPreload(
    basePlayers,
    isLoading,
    dataInfo.fantasyProsSeason
  );
  const { readiness } = useDraftDecision();

  const [positionFilter, setPositionFilter] = React.useState<PositionFilter>('ALL');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [showDrafted, setShowDrafted] = React.useState(false);
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const [selectedPlayer, setSelectedPlayer] = React.useState<Player | null>(null);

  const draftedIds = useDraftStore((state) => state.draftedPlayerIds);
  const shortlistedPlayerIds = useDraftStore((state) => state.shortlistedPlayerIds);
  const markPlayerDrafted = useDraftStore((state) => state.markPlayerDrafted);
  const addToMyRoster = useDraftStore((state) => state.addToMyRoster);
  const togglePlayerShortlisted = useDraftStore((state) => state.togglePlayerShortlisted);
  const config = useDraftStore((state) => state.config);
  const currentPick = useDraftStore((state) => state.currentPick);
  const preloadedKeepers = useDraftStore((state) => state.preloadedKeepers);
  const mockSurvivalProbabilities = useDraftStore(
    (state) => state.mockSurvivalProbabilities
  );
  const sessionMode = useDraftSessionMode();

  const players = React.useMemo(() => {
    if (sessionMode !== 'mock') return basePlayers;
    return basePlayers.map((player) => {
      const probability = mockSurvivalProbabilities[player.id];
      return probability === undefined
        ? player
        : { ...player, nextPickSurvivalProbability: probability };
    });
  }, [basePlayers, mockSurvivalProbabilities, sessionMode]);

  const isMyTurn = useIsMyTurn();
  const keeperAtCurrentPick = sessionMode === 'mock'
    ? getKeeperAtPick(preloadedKeepers, currentPick, config.totalTeams)
    : undefined;
  const canRecordPicks = sessionMode !== 'setup' && keeperAtCurrentPick === undefined;
  const isActiveUserTurn = canRecordPicks && isMyTurn;

  // Filter players based on UI state
  const filteredPlayers = React.useMemo(() => {
    let result = players;

    // Position filter - handle FLEX (RB/WR/TE)
    if (positionFilter === 'FLEX') {
      result = result.filter((p) => FLEX_POSITIONS.includes(p.position));
    } else if (positionFilter !== 'ALL') {
      result = result.filter((p) => p.position === positionFilter);
    }

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.team.toLowerCase().includes(query)
      );
    }

    // Drafted filter
    if (!showDrafted) {
      result = result.filter((p) => !draftedIds.has(p.id));
    }

    return result;
  }, [players, positionFilter, searchQuery, showDrafted, draftedIds]);
  const mobilePlayers = React.useMemo(() => {
    const result = [...filteredPlayers];
    return result.sort((left, right) => {
      if (positionFilter === 'ALL' || positionFilter === 'FLEX') {
        return left.ecrRank - right.ecrRank;
      }
      return left.tier - right.tier ||
        right.valueOverReplacement - left.valueOverReplacement;
    });
  }, [filteredPlayers, positionFilter]);

  const tierAvailability = React.useMemo(
    () => calculateTierAvailability(
      players.filter((player) => !draftedIds.has(player.id))
    ),
    [players, draftedIds]
  );
  const getPlayerTierAvailability = React.useCallback(
    (player: Player): TierAvailability | undefined =>
      tierAvailability.get(getTierKey(player.position, player.tier)),
    [tierAvailability]
  );

  // Handle drafting a player
  const handleDraft = React.useCallback(
    (player: Player) => {
      if (!canRecordPicks || draftedIds.has(player.id)) return;

      const teamIndex = (() => {
        const round = Math.ceil(currentPick / config.totalTeams);
        const pickInRound = ((currentPick - 1) % config.totalTeams) + 1;
        const isOddRound = round % 2 === 1;
        return isOddRound ? pickInRound - 1 : config.totalTeams - pickInRound;
      })();

      const teamName = isActiveUserTurn ? 'My Team' : `Team ${teamIndex + 1}`;

      markPlayerDrafted(
        player.id,
        player.name,
        player.position,
        teamIndex,
        teamName,
        undefined,
        'manual',
        player.team
      );

      if (isActiveUserTurn) {
        addToMyRoster(player);
      }
    },
    [currentPick, config.totalTeams, draftedIds, canRecordPicks, isActiveUserTurn, markPlayerDrafted, addToMyRoster]
  );

  const handleInspect = React.useCallback(
    (player: Player) => {
      if (draftedIds.has(player.id)) return;
      setSelectedPlayer(player);
    },
    [draftedIds]
  );

  const handleToggleShortlist = React.useCallback(
    (player: Player) => {
      togglePlayerShortlisted(player.id);
    },
    [togglePlayerShortlisted]
  );

  // Get columns with draft action
  const columns = React.useMemo(
    () =>
      getColumnsWithActions(handleDraft, {
        advanced: showAdvanced,
        onInspect: handleInspect,
        onToggleShortlist: handleToggleShortlist,
        isShortlisted: (player) => shortlistedPlayerIds.includes(player.id),
        isDrafted: (player) => draftedIds.has(player.id),
        canDraft: canRecordPicks,
        getTierAvailability: getPlayerTierAvailability,
      }),
    [canRecordPicks, draftedIds, getPlayerTierAvailability, handleDraft, handleInspect, handleToggleShortlist, shortlistedPlayerIds, showAdvanced]
  );

  // Get row styling (drafted players greyed out)
  const getRowClassName = React.useCallback(
    (player: Player) => {
      if (draftedIds.has(player.id)) {
        return 'opacity-40 bg-muted/30';
      }
      return cn(
        getRowHighlightClass(player),
        shortlistedPlayerIds.includes(player.id) && 'ring-1 ring-inset ring-amber-400/40'
      );
    },
    [draftedIds, shortlistedPlayerIds]
  );

  const getRowGroupLabel = React.useCallback(
    (player: Player, previousPlayer: Player | undefined): React.ReactNode => {
      if (positionFilter === 'ALL' || positionFilter === 'FLEX') return null;
      if (previousPlayer?.position === player.position && previousPlayer.tier === player.tier) {
        return null;
      }
      const availability = getPlayerTierAvailability(player);
      const cliff = availability?.nextTier !== undefined
        ? ` · ${availability.dropoffPoints.toFixed(1)} point ${availability.isMeaningfulCliff ? 'cliff' : 'gap'} to T${String(availability.nextTier)}`
        : '';
      return (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold">
            {player.position} Tier {player.tier}
          </span>
          <span className="text-muted-foreground">
            {availability ? `${String(availability.remaining)} remaining${cliff}` : 'availability unknown'}
          </span>
        </div>
      );
    },
    [getPlayerTierAvailability, positionFilter]
  );

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-64">
          <div className="text-muted-foreground">Loading player data...</div>
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-64">
          <div className="text-destructive">
            Error loading data: {error?.message ?? 'Unknown error'}
          </div>
        </CardContent>
      </Card>
    );
  }

  const round = Math.ceil(currentPick / config.totalTeams);
  const pickInRound = ((currentPick - 1) % config.totalTeams) + 1;

  return (
    <>
      <Card className="gap-4 rounded-lg py-5">
        <CardHeader className="pb-1">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-2">
              <CardTitle className="flex flex-wrap items-center gap-3 text-lg">
                Available Players
                {isActiveUserTurn && (
                  <Badge className="bg-green-500 text-white">Your Pick</Badge>
                )}
              </CardTitle>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                {sessionMode === 'setup' ? (
                  <span>Preview board · connect a live draft or start a mock to record picks</span>
                ) : (
                  <>
                    <span>{sessionMode === 'mock' ? 'Mock draft' : 'Live draft'}</span>
                    <span>·</span>
                    <span>Round {round}</span>
                    <span>·</span>
                    <span>Pick {pickInRound}</span>
                    <span>·</span>
                    <span className="font-mono">#{currentPick}</span>
                  </>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <MyRoster />
              <MockDraftControls
                players={players}
                isMockReady={keeperStatus.isMockReady}
                sessionMode={sessionMode}
              />
            </div>
          </div>
        </CardHeader>

        <OnTheClock players={players} onDraft={handleDraft} />
        <ShortlistQueue
          players={players}
          onDraft={handleDraft}
          canDraft={canRecordPicks}
        />

        <CardContent className="space-y-4">
          <KeeperPoolStatus status={keeperStatus} />

          {readiness ? <DraftConnect
            fantasyProsRefreshedAt={dataInfo.fantasyProsRefreshedAt}
            sleeperFetchedAt={dataInfo.sleeperFetchedAt}
            fantasyProsSourceType={dataInfo.fantasyProsSourceType}
            predictionModelVersion={dataInfo.predictionModelVersion}
            predictionGeneratedAt={dataInfo.predictionGeneratedAt}
            shadowRecommendationAvailable={dataInfo.shadowRecommendationAvailable}
            recommendationPolicyReason={dataInfo.recommendationPolicyReason}
            dataFreshness={dataInfo.dataFreshness}
            readiness={readiness}
          /> : null}

          {/* Filters */}
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="space-y-2">
              <PositionFilters selected={positionFilter} onSelect={setPositionFilter} />
              <PositionStats />
              <p className="max-w-2xl text-[11px] leading-relaxed text-muted-foreground">
                Position tiers group players until a meaningful projected-point
                drop-off. Availability counts update after every pick.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="space-y-1">
                <label
                  htmlFor="player-search"
                  className="block text-xs font-medium text-muted-foreground"
                >
                  Search players
                </label>
                <Input
                  id="player-search"
                  placeholder="Name or team"
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); }}
                  className="w-56"
                />
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  id="show-drafted"
                  checked={showDrafted}
                  onCheckedChange={setShowDrafted}
                />
                <label
                  htmlFor="show-drafted"
                  className="cursor-pointer text-sm text-muted-foreground"
                >
                  Unavailable
                </label>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  id="show-advanced"
                  checked={showAdvanced}
                  onCheckedChange={setShowAdvanced}
                />
                <label
                  htmlFor="show-advanced"
                  className="cursor-pointer text-sm text-muted-foreground"
                >
                  Advanced
                </label>
              </div>
            </div>
          </div>

          <MobilePlayerCards
            players={mobilePlayers}
            canDraft={canRecordPicks}
            onDraft={handleDraft}
            onInspect={handleInspect}
            onToggleShortlist={handleToggleShortlist}
            isShortlisted={(player) => shortlistedPlayerIds.includes(player.id)}
            isDrafted={(player) => draftedIds.has(player.id)}
            getTierAvailability={getPlayerTierAvailability}
          />

          <div className="hidden md:block">
            <DataTable
              key={positionFilter}
              columns={columns}
              data={filteredPlayers}
              onRowClick={handleInspect}
              getRowClassName={getRowClassName}
              getRowGroupLabel={getRowGroupLabel}
              pageSize={30}
              initialSorting={
                positionFilter === 'ALL' || positionFilter === 'FLEX'
                  ? ECR_SORTING
                  : TIER_SORTING
              }
            />
          </div>

        </CardContent>
      </Card>

      <PlayerDetailDialog
        player={selectedPlayer}
        isDrafted={selectedPlayer !== null && draftedIds.has(selectedPlayer.id)}
        tierAvailability={selectedPlayer ? getPlayerTierAvailability(selectedPlayer) : undefined}
        open={selectedPlayer !== null && !draftedIds.has(selectedPlayer.id)}
        onOpenChange={(open) => {
          if (!open) setSelectedPlayer(null);
        }}
        onDraft={handleDraft}
        canDraft={canRecordPicks}
      />
    </>
  );
}
