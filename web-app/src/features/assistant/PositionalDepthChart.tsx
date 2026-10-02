import { useId, useMemo, useRef, useState } from 'react';
import { POSITIONS, type Player, type Position, type PositionNeed } from '@fantasy-draft/shared';
import { Check, ChevronDown, ChevronRight, ListPlus, X } from 'lucide-react';
import { MotionFade } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { MetricHelp } from '@/features/help/MetricHelp';
import { usePlayerDataQuery } from '@/hooks/usePlayerData';
import { useQueueActions } from '@/hooks/useQueueActions';
import { estimateLeagueSurvivalProbability, getNextUserPick } from '@/lib/calculations/survival';
import { getEffectiveKeeperAssignments } from '@/lib/keeper-supply';
import { useLeagueTimingEvidence } from '@/hooks/useLeagueTimingEvidence';
import { formatSignedNumber } from '@/lib/utils';
import { useDraftStore } from '@/stores/draftStore';
import {
  depthTier, getAvailableDepthPlayers, getDepthPlayers, getDepthRosterOpenings,
  getDepthTierDrop, getDepthTiers, type DepthFilter,
} from './positional-depth';

function tierLabel(tier: DepthFilter): string {
  return tier === 'all' ? 'All tiers' : tier === 'unranked' ? 'Unranked' : `Tier ${String(tier)}`;
}

function DepthPlayers({ players, allPlayers, timingPool, position, tier, onClose }: {
  readonly players: readonly Player[];
  readonly allPlayers: readonly Player[];
  readonly timingPool: readonly Player[];
  readonly position: Position;
  readonly tier: DepthFilter;
  readonly onClose: () => void;
}): React.ReactElement {
  const [limit, setLimit] = useState(8);
  const config = useDraftStore((state) => state.config);
  const currentPick = useDraftStore((state) => state.currentPick);
  const queuedIds = useDraftStore((state) => state.shortlistedPlayerIds);
  const sessionMode = useDraftStore((state) => state.sessionMode);
  const mockProbabilities = useDraftStore((state) => state.mockSurvivalProbabilities);
  const { togglePlayerQueued } = useQueueActions(players);
  const timingEvidence = useLeagueTimingEvidence();
  const timing = useMemo(() => {
    const context = { currentPick, myPickPosition: config.myPickPosition, totalTeams: config.totalTeams, totalRounds: config.totalRounds, draftType: config.draftType };
    return new Map(players.slice(0, limit).map((player) => {
      if (getNextUserPick(context) === null) return [player.id, null];
      const estimate = estimateLeagueSurvivalProbability(player, timingEvidence.model, context, timingPool);
      const probability = sessionMode === 'mock' && timingEvidence.model
        ? mockProbabilities[player.id] ?? estimate.nextPickSurvivalProbability
        : estimate.nextPickSurvivalProbability;
      return [player.id, Number.isFinite(probability) && probability >= 0 && probability <= 1 ? Math.round(probability * 100) : null];
    }));
  }, [timingPool, config.myPickPosition, config.totalRounds, config.totalTeams, config.draftType, currentPick, limit, mockProbabilities, timingEvidence.model, players, sessionMode]);
  const drop = getDepthTierDrop(allPlayers, position, tier);
  const aboveReplacement = players.filter((player) => player.valueOverReplacement > 0).length;

  return (
    <div className="depth-player-detail">
      <div className="depth-detail-heading">
        <div>
          <h3>{position} · {tierLabel(tier)}</h3>
          <p>{String(players.length)} available · {String(aboveReplacement)} above replacement</p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label={`Close ${position} players`} onClick={onClose}><X className="size-4" /></Button>
      </div>
      {typeof tier === 'number' && players.length > 0 ? (
        <p className="depth-tier-drop">
          {drop
            ? drop.points > 0
              ? `Tier ${String(drop.nextTier)} starts ${String(drop.points)} projected season points below the lowest remaining player in Tier ${String(tier)}.`
              : `There is no projected point drop to the next available tier, Tier ${String(drop.nextTier)}.`
            : 'No comparable next-tier projection is available.'}
        </p>
      ) : null}
      {players.length === 0 ? <p className="depth-empty" role="status">No players remain in this group. Choose another tier.</p> : (
        <>
          <MotionFade motionKey={players.map((player) => player.id).join(':')}>
            <div className="depth-player-scroll">
              <table className="depth-player-table">
                <caption className="sr-only">Available {position} players in {tierLabel(tier)}, ordered by expert rank</caption>
                <thead><tr>
                  <th scope="col">Player</th>
                  <th scope="col"><MetricHelp metric="vor" label="Value" /></th>
                  <th scope="col"><MetricHelp metric="returnProbability" label="At next pick" /></th>
                  <th scope="col">Queue</th>
                </tr></thead>
                <tbody>{players.slice(0, limit).map((player) => {
                  const queued = queuedIds.includes(player.id);
                  const chance = timing.get(player.id);
                  return <tr key={player.id}>
                    <th scope="row"><span className="depth-player-name">{player.name}</span><span className="depth-player-meta">{player.team} · {tierLabel(depthTier(player.tier))} · ECR #{String(player.ecrRank)}</span></th>
                    <td>{Number.isFinite(player.valueOverReplacement) ? formatSignedNumber(player.valueOverReplacement, 0) : '—'}</td>
                    <td>{chance == null ? <span title="No next-pick estimate available">—</span> : `${String(chance)}%`}</td>
                    <td><Button variant={queued ? 'secondary' : 'ghost'} size="icon-sm" aria-pressed={queued}
                      aria-label={`${queued ? 'Remove' : 'Add'} ${player.name} ${queued ? 'from' : 'to'} queue`}
                      onClick={() => { togglePlayerQueued(player.id); }}>
                      {queued ? <Check className="size-4" /> : <ListPlus className="size-4" />}
                    </Button></td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
          </MotionFade>
          {players.length > limit ? <Button variant="ghost" size="sm" className="depth-show-more" onClick={() => { setLimit((value) => value + 8); }}>Show {String(Math.min(8, players.length - limit))} more · {String(players.length - limit)} remaining</Button> : null}
        </>
      )}
    </div>
  );
}

export default function PositionalDepthChart({ needs }: {
  readonly needs: readonly PositionNeed[];
}): React.ReactElement {
  const { players } = usePlayerDataQuery();
  const draftedIds = useDraftStore((state) => state.draftedPlayerIds);
  const history = useDraftStore((state) => state.draftHistory);
  const keepers = useDraftStore((state) => state.preloadedKeepers);
  const config = useDraftStore((state) => state.config);
  const [showAll, setShowAll] = useState(false);
  const [showSpecialTeams, setShowSpecialTeams] = useState(false);
  const [selection, setSelection] = useState<{ position: Position; tier: DepthFilter } | null>(null);
  const selectionTrigger = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const detailId = useId();
  const available = useMemo(() => {
    const excluded = new Set([...draftedIds, ...history.map((pick) => pick.playerId),
      ...getEffectiveKeeperAssignments(keepers, history, config.totalTeams, config.draftType).map((keeper) => keeper.playerId)]);
    return getAvailableDepthPlayers(players, excluded);
  }, [players, draftedIds, history, keepers, config.totalTeams, config.draftType]);
  const positions = POSITIONS.filter((position) => config.rosterRequirements[position].starters > 0 ||
    (config.rosterRequirements.FLEX.starters > 0 && config.rosterRequirements.FLEX.eligiblePositions.includes(position)));
  const secondary = positions.filter((position) => (position === 'K' || position === 'DEF') &&
    needs.some((need) => need.position === position && ['defer', 'filled', 'low'].includes(need.priority)));
  const primary = positions.filter((position) => !secondary.includes(position));
  const tiers = getDepthTiers(available.filter((player) => positions.includes(player.position)), showAll);
  const openings = getDepthRosterOpenings(needs);
  const active = selection && positions.includes(selection.position) &&
    (showSpecialTeams || !secondary.includes(selection.position)) &&
    (selection.tier === 'all' || tiers.includes(selection.tier)) ? selection : null;
  const activePosition = active?.position;
  const activeTier = active?.tier;
  const selectedPlayers = useMemo(() => activePosition && activeTier !== undefined
    ? getDepthPlayers(available, activePosition, activeTier) : [], [available, activePosition, activeTier]);

  function select(position: Position, tier: DepthFilter): void {
    setSelection((previous) => previous?.position === position && previous.tier === tier ? null : { position, tier });
  }

  function table(group: readonly Position[], label: string): React.ReactElement {
    return <div className="depth-matrix-scroll"><table className="depth-matrix">
      <caption className="sr-only">{label}. Select a position or tier count to see available players.</caption>
      <thead><tr><th scope="col">Position</th><th scope="col">Open starters</th>{tiers.map((tier) => <th scope="col" key={tier}>{tierLabel(tier)}<span>left</span></th>)}</tr></thead>
      <tbody>{group.map((position) => {
        const positionPlayers = available.filter((player) => player.position === position);
        const expanded = active?.position === position;
        return <tr key={position} data-selected={expanded}>
            <th scope="row"><button type="button" className="depth-position-button" aria-label={`Show available ${position} players`}
              aria-expanded={expanded} aria-controls={expanded ? detailId : undefined} onClick={(event) => { selectionTrigger.current = event.currentTarget; setSelection(expanded ? null : { position, tier: 'all' }); }}>
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{position}
            </button></th>
            <td className="depth-open-slots">{String(openings.fixed.get(position) ?? 0)}</td>
            {tiers.map((tier) => {
              const count = positionPlayers.filter((player) => depthTier(player.tier) === tier).length;
              const selected = expanded && active.tier === tier;
              return <td key={tier}><button type="button" className="depth-count-button" data-selected={selected}
                aria-label={`${position} ${tierLabel(tier)}: ${String(count)} available players`}
                aria-expanded={selected} aria-controls={expanded ? detailId : undefined} onClick={(event) => { selectionTrigger.current = event.currentTarget; select(position, tier); }}>
                <MotionFade motionKey={count}>{String(count)}</MotionFade>
              </button></td>;
            })}
          </tr>;
      })}</tbody>
    </table></div>;
  }

  return <section className="positional-depth" aria-labelledby={titleId}>
    <div className="depth-heading">
      <div><h3 id={titleId}>Positional depth</h3><p>Players left by tier. Select a count to see your options.</p></div>
      <Button variant="ghost" size="sm" aria-pressed={showAll} onClick={() => { setShowAll((value) => !value); }}>{showAll ? 'Show Tier 1–3' : 'Show all tiers'}</Button>
    </div>
    {table(primary, 'Available players by position')}
    {secondary.length > 0 ? <>
      <button type="button" className="depth-secondary-toggle" aria-expanded={showSpecialTeams} onClick={() => { setShowSpecialTeams((value) => !value); }}>
        {showSpecialTeams ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{showSpecialTeams ? 'Hide' : 'Show'} {secondary.join(' / ')}
      </button>
      {showSpecialTeams ? table(secondary, 'Available kickers and defenses') : null}
    </> : null}
    {config.rosterRequirements.FLEX.starters > 0 ? <p className="depth-flex-note"><strong>{String(openings.flex)} shared FLEX {openings.flex === 1 ? 'opening' : 'openings'}</strong> · {config.rosterRequirements.FLEX.eligiblePositions.join(', ')}. Counted separately from fixed starters.</p> : null}
    {active ? <div id={detailId}><DepthPlayers key={`${active.position}:${String(active.tier)}`} players={selectedPlayers} allPlayers={available} timingPool={players} position={active.position} tier={active.tier} onClose={() => { setSelection(null); selectionTrigger.current?.focus(); }} /></div> : null}
    <p className="depth-footnote">Tiers compare players within a position; group sizes vary. Drafted players and keepers are excluded.</p>
  </section>;
}
