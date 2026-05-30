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
import { SleeperConnect } from './SleeperConnect';
import { MyRoster } from '@/features/my-roster';
import { useFilteredPlayers, usePositionStats } from '@/hooks/usePlayerData';
import { useDraftStore } from '@/stores/draftStore';
import { cn, formatSignedNumber } from '@/lib/utils';

/** Position filter type including FLEX */
type PositionFilter = Position | 'ALL' | 'FLEX';

/** FLEX eligible positions */
const FLEX_POSITIONS: Position[] = ['RB', 'WR', 'TE'];

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
          className={cn(
            'min-w-12 transition-colors',
            selected === pos && colors[pos]
          )}
          onClick={() => onSelect(pos)}
        >
          {pos}
        </Button>
      ))}
    </div>
  );
}

/**
 * Draft simulation controls for testing
 * Uses getState() to ensure fresh state on each action
 */
function DraftSimulationControls({ players }: { players: Player[] }) {
  const [isOpen, setIsOpen] = React.useState(false);
  const draftedCount = useDraftStore((state) => state.draftedPlayerIds.size);

  // Simulate picking the top available player - uses fresh state each call
  const simulateNextPick = () => {
    const state = useDraftStore.getState();
    const { draftedPlayerIds, currentPick, config, markPlayerDrafted } = state;

    // Find top available player
    const topPlayer = players.find((p) => !draftedPlayerIds.has(p.id));
    if (!topPlayer) {
      console.log('No available players left');
      return;
    }

    const round = Math.ceil(currentPick / config.totalTeams);
    const pickInRound = ((currentPick - 1) % config.totalTeams) + 1;
    const isOddRound = round % 2 === 1;
    const teamIndex = isOddRound ? pickInRound - 1 : config.totalTeams - pickInRound;

    console.log(`Simulating pick #${currentPick}: ${topPlayer.name} to Team ${teamIndex + 1}`);

    markPlayerDrafted(
      topPlayer.id,
      topPlayer.name,
      topPlayer.position,
      teamIndex,
      `Team ${teamIndex + 1}`
    );
  };

  // Simulate a full round of picks
  const simulateRound = () => {
    const { config } = useDraftStore.getState();
    for (let i = 0; i < config.totalTeams; i++) {
      simulateNextPick();
    }
  };

  const handleUndo = () => {
    console.log('Undoing last pick');
    useDraftStore.getState().undoLastPick();
  };

  const handleReset = () => {
    console.log('Resetting draft');
    useDraftStore.getState().resetDraft();
  };

  if (!isOpen) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsOpen(true)}
        className="text-xs"
      >
        Test Mode
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg border border-dashed">
      <span className="text-xs text-muted-foreground font-medium">
        Simulate ({draftedCount} drafted):
      </span>
      <Button variant="outline" size="sm" onClick={simulateNextPick} className="text-xs h-7">
        Next Pick
      </Button>
      <Button variant="outline" size="sm" onClick={simulateRound} className="text-xs h-7">
        Full Round
      </Button>
      <Button variant="outline" size="sm" onClick={handleUndo} className="text-xs h-7">
        Undo
      </Button>
      <Button variant="destructive" size="sm" onClick={handleReset} className="text-xs h-7">
        Reset
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setIsOpen(false)}
        className="text-xs h-7 ml-auto"
      >
        Close
      </Button>
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
      'bg-emerald-500/[0.08] hover:bg-emerald-500/[0.12] dark:bg-emerald-500/[0.10] dark:hover:bg-emerald-500/[0.16]',
    'good-value':
      'bg-amber-500/[0.08] hover:bg-amber-500/[0.12] dark:bg-amber-500/[0.10] dark:hover:bg-amber-500/[0.16]',
    neutral: 'hover:bg-muted/35',
    avoid:
      'bg-red-500/[0.08] hover:bg-red-500/[0.12] dark:bg-red-500/[0.10] dark:hover:bg-red-500/[0.16]',
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
  open,
  onOpenChange,
  onDraft,
}: {
  player: Player | null;
  isDrafted: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDraft: (player: Player) => void;
}) {
  if (!player) {
    return null;
  }

  const marketTone = player.valueScore > 0 ? 'good' : player.valueScore < -5 ? 'bad' : 'neutral';
  const risk = Math.max(player.injuryRiskScore, player.uncertaintyScore);
  const riskTone = risk >= 6 ? 'bad' : risk >= 4.5 ? 'warn' : 'neutral';

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
            label="VOR"
            value={formatSignedNumber(player.valueOverReplacement, 1)}
            detail="vs replacement"
            tone="good"
          />
          <MetricTile
            label="Projection"
            value={player.projectedPoints.toFixed(1)}
            detail={player.predictionSource}
          />
          <MetricTile
            label="Market"
            value={`${player.valueScore > 0 ? '+' : ''}${player.valueScore}`}
            detail={`FP ${player.ecrRank} / SL ${player.marketRank}`}
            tone={marketTone}
          />
          <MetricTile
            label="Wait"
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
            value={risk.toFixed(1)}
            detail={`avail ${player.injuryRiskScore.toFixed(1)} / unc ${player.uncertaintyScore.toFixed(1)}`}
            tone={riskTone}
          />
          <MetricTile
            label="Tier"
            value={String(player.tier)}
            detail={`drop ${player.tierDropoffScore.toFixed(2)}`}
          />
        </div>

        <div className="flex justify-end">
          <Button
            disabled={isDrafted}
            onClick={() => {
              if (isDrafted) return;
              onDraft(player);
              onOpenChange(false);
            }}
          >
            {isDrafted ? 'Already drafted' : `Draft ${player.name}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Main PlayerTable component
 */
export function PlayerTable() {
  const { players, isLoading, isError, error, dataInfo } =
    useFilteredPlayers();

  const [positionFilter, setPositionFilter] = React.useState<PositionFilter>('ALL');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [showDrafted, setShowDrafted] = React.useState(false);
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const [selectedPlayer, setSelectedPlayer] = React.useState<Player | null>(null);

  const draftedIds = useDraftStore((state) => state.draftedPlayerIds);
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

  // Handle drafting a player
  const handleDraft = React.useCallback(
    (player: Player) => {
      if (draftedIds.has(player.id)) return;

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
    [currentPick, config.totalTeams, draftedIds, isMyTurn, markPlayerDrafted, addToMyRoster]
  );

  const handleInspect = React.useCallback(
    (player: Player) => {
      if (draftedIds.has(player.id)) return;
      setSelectedPlayer(player);
    },
    [draftedIds]
  );

  // Get columns with draft action
  const columns = React.useMemo(
    () =>
      getColumnsWithActions(handleDraft, {
        advanced: showAdvanced,
        onInspect: handleInspect,
      }),
    [handleDraft, handleInspect, showAdvanced]
  );

  // Get row styling (drafted players greyed out)
  const getRowClassName = React.useCallback(
    (player: Player) => {
      if (draftedIds.has(player.id)) {
        return 'opacity-40 bg-muted/30';
      }
      return getRowHighlightClass(player);
    },
    [draftedIds]
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
                {isMyTurn && (
                  <Badge className="bg-green-500 text-white">Your Pick</Badge>
                )}
              </CardTitle>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span>Round {round}</span>
                <span>·</span>
                <span>Pick {pickInRound}</span>
                <span>·</span>
                <span className="font-mono">#{currentPick}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <SleeperConnect />
              <MyRoster />
              <DraftSimulationControls players={players} />
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="space-y-2">
              <PositionFilters selected={positionFilter} onSelect={setPositionFilter} />
              <PositionStats />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Input
                placeholder="Search players..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-56"
              />

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
                  Drafted
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

          <DataTable
            columns={columns}
            data={filteredPlayers}
            onRowClick={handleInspect}
            getRowClassName={getRowClassName}
            pageSize={30}
          />

          {/* Data freshness info */}
          <div className="space-y-1 text-right text-xs">
            {dataInfo.contractsError && (
              <div className="text-destructive/80">
                Contract-year data unavailable.
              </div>
            )}
            {dataInfo.fantasyProsRefreshedAt && (
              <div className="text-muted-foreground">
                FantasyPros snapshot from{' '}
                {new Date(dataInfo.fantasyProsRefreshedAt).toLocaleString()}
                {dataInfo.fantasyProsSourceType && (
                  <span>
                    {' · '}
                    {dataInfo.fantasyProsSourceType}
                  </span>
                )}
              </div>
            )}
            {dataInfo.sleeperFetchedAt && (
              <div className="text-muted-foreground">
                Sleeper market snapshot from{' '}
                {new Date(dataInfo.sleeperFetchedAt).toLocaleString()}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <PlayerDetailDialog
        player={selectedPlayer}
        isDrafted={selectedPlayer !== null && draftedIds.has(selectedPlayer.id)}
        open={selectedPlayer !== null && !draftedIds.has(selectedPlayer.id)}
        onOpenChange={(open) => {
          if (!open) setSelectedPlayer(null);
        }}
        onDraft={handleDraft}
      />
    </>
  );
}
