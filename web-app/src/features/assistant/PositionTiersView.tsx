import { PositionTag } from '@/components/PositionTag';
import type { Player, Position, PositionNeed, Recommendation } from '@fantasy-draft/shared';
import { Check, Plus, Search } from 'lucide-react';
import * as React from 'react';

import { survivalPercent } from './assistant-analysis';
import { buildPositionTiers, isTierDepleted, type TierGroup, type TierPlayer } from './assistant-tiers';

type TierFilter = 'ALL' | Position;

const FILTERS: readonly TierFilter[] = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const DEFAULT_POSITIONS: readonly Position[] = ['QB', 'RB', 'WR', 'TE'];
const POSITION_NAMES: Readonly<Record<Position, string>> = {
  QB: 'Quarterbacks', RB: 'Running backs', WR: 'Wide receivers', TE: 'Tight ends', K: 'Kickers', DEF: 'Defenses',
};
/** Tiers shown per column before expanding; later tiers are rarely draft decisions yet. */
const VISIBLE_TIERS = 4;
const VISIBLE_PLAYERS_PER_TIER = 3;

function TierRow({
  player,
  drafted,
  recommendation,
  isBestPick,
  isSelected,
  isQueued,
  nextPickLabel,
  onSelect,
  onQueue,
}: {
  readonly player: TierPlayer;
  readonly drafted: boolean;
  readonly recommendation?: Recommendation;
  readonly isBestPick: boolean;
  readonly isSelected: boolean;
  readonly isQueued: boolean;
  readonly nextPickLabel: string | null;
  readonly onSelect: (playerId: string) => void;
  readonly onQueue: (playerId: string) => void;
}): React.ReactElement {
  const survival = recommendation ? survivalPercent(recommendation) : null;
  return (
    <li className="rec-tier-row" data-drafted={drafted} data-selected={isSelected}>
      <span className="rec-candidate-rank" aria-label={`ECR ${String(player.ecrRank)}`}>{String(player.ecrRank)}</span>
      <button type="button" className="rec-candidate-identity" disabled={drafted} onClick={() => { onSelect(player.id); }}>
        <span className="rec-candidate-name">{player.name}</span>
        <span className="rec-meta">
          <span>{player.team}</span>
          {drafted ? <span>Drafted</span> : null}
          {isBestPick ? <span className="rec-accent">Best Pick</span> : null}
          {isSelected ? <span className="rec-viewing">Viewing</span> : null}
        </span>
      </button>
      {drafted ? <span className="rec-muted">Taken</span> : (
        <>
          <span className="rec-candidate-value" title={`Return Probability at ${nextPickLabel ?? 'your next pick'}`}>
            {survival === null ? <span className="rec-unknown">—</span> : `${String(survival)}%`}
          </span>
          <button
            type="button"
            className="rec-icon-button rec-queue-toggle"
            aria-pressed={isQueued}
            aria-label={`${isQueued ? 'Remove' : 'Add'} ${player.name} ${isQueued ? 'from' : 'to'} queue`}
            onClick={() => { onQueue(player.id); }}
          >
            {isQueued ? <Check aria-hidden="true" /> : <Plus aria-hidden="true" />}
          </button>
        </>
      )}
    </li>
  );
}

/** Position columns grouped by tier: how much is left at each position, beside Suggestions. */
export function PositionTiersView({
  players,
  draftedPlayerIds,
  recommendationById,
  bestPickId,
  selectedPlayerId,
  queuedSet,
  needs,
  nextPickLabel,
  onSelect,
  onQueue,
}: {
  readonly players: readonly Player[];
  readonly draftedPlayerIds: ReadonlySet<string>;
  readonly recommendationById: ReadonlyMap<string, Recommendation>;
  readonly bestPickId: string | undefined;
  readonly selectedPlayerId: string | undefined;
  readonly queuedSet: ReadonlySet<string>;
  readonly needs: readonly PositionNeed[];
  readonly nextPickLabel: string | null;
  readonly onSelect: (playerId: string) => void;
  readonly onQueue: (playerId: string) => void;
}): React.ReactElement {
  const [filter, setFilter] = React.useState<TierFilter>('ALL');
  const [query, setQuery] = React.useState('');
  const deferredQuery = React.useDeferredValue(query);
  const [showDrafted, setShowDrafted] = React.useState(false);
  const [expandedTiers, setExpandedTiers] = React.useState<ReadonlySet<string>>(new Set());
  const [allTierPositions, setAllTierPositions] = React.useState<ReadonlySet<Position>>(new Set());
  const positions = filter === 'ALL' ? DEFAULT_POSITIONS : [filter];
  const columns = React.useMemo(
    () => (filter === 'ALL' ? DEFAULT_POSITIONS : [filter]).map((position) =>
      buildPositionTiers({ players, position, draftedPlayerIds, query: deferredQuery, showDrafted })),
    [players, filter, draftedPlayerIds, deferredQuery, showDrafted]
  );
  const anyMatches = columns.some((column) => column.groups.length > 0);
  const toggle = <T,>(set: ReadonlySet<T>, value: T): ReadonlySet<T> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  const renderGroup = (group: TierGroup, position: Position): React.ReactElement => {
    const key = `${position}-${String(group.tier)}`;
    const expanded = expandedTiers.has(key) || deferredQuery.trim() !== '';
    const listed = expanded ? group.players : group.players.slice(0, VISIBLE_PLAYERS_PER_TIER);
    const hidden = group.players.length - listed.length;
    return (
      <section key={key} className="rec-tier-group" aria-label={`${position} Tier ${String(group.tier)}`}>
        <div className="rec-tier-header">
          <strong>Tier {String(group.tier)}</strong>
          <span className="rec-muted">{String(group.available)} of {String(group.total)} left</span>
        </div>
        {isTierDepleted(group) ? <p className="rec-tier-caption">Only {String(group.available)} left in this tier</p> : null}
        <ol>
          {listed.map((player) => (
            <TierRow
              key={player.id}
              player={player}
              drafted={draftedPlayerIds.has(player.id)}
              recommendation={recommendationById.get(player.id)}
              isBestPick={player.id === bestPickId}
              isSelected={player.id === selectedPlayerId}
              isQueued={queuedSet.has(player.id)}
              nextPickLabel={nextPickLabel}
              onSelect={onSelect}
              onQueue={onQueue}
            />
          ))}
        </ol>
        {hidden > 0 || expandedTiers.has(key) ? (
          <button type="button" className="rec-text-button rec-tier-more" aria-expanded={expanded} onClick={() => { setExpandedTiers((current) => toggle(current, key)); }}>
            {expanded ? 'Show fewer' : `Show ${String(hidden)} more`}
          </button>
        ) : null}
      </section>
    );
  };

  return (
    <section className="rec-tiers" aria-labelledby="rec-tiers-heading">
      <div className="rec-section-heading">
        <h1 id="rec-tiers-heading">Position tiers</h1>
        <span className="rec-muted">
          Tiers group players of similar value. Counts include drafted players. Percentages are Return Probability at {nextPickLabel ?? 'your next pick'}.
        </span>
      </div>
      <div className="rec-pool-toolbar">
        <label className="rec-search">
          <Search className="size-4" aria-hidden="true" />
          <span className="sr-only">Search players in tiers</span>
          <input value={query} onChange={(event) => { setQuery(event.target.value); }} placeholder="Search player or team" />
        </label>
        <div className="rec-filters" role="group" aria-label="Filter tiers by position">
          {FILTERS.map((position) => {
            const need = position === 'ALL' ? undefined : needs.find((item) => item.position === position);
            return (
              <button
                key={position}
                type="button"
                aria-pressed={filter === position}
                aria-label={position === 'ALL' ? 'QB, RB, WR and TE' : `${position}, ${String(need?.startersFilled ?? 0)} of ${String(need?.startersNeeded ?? 0)} starters filled`}
                onClick={() => { setFilter(position); }}
              >
                <span>{position === 'ALL' ? 'All' : position}</span>
                {need ? <small>{String(need.startersFilled)}/{String(need.startersNeeded)}</small> : null}
              </button>
            );
          })}
        </div>
        <label className="rec-checkbox">
          <input type="checkbox" checked={showDrafted} onChange={(event) => { setShowDrafted(event.target.checked); }} />
          Show drafted
        </label>
      </div>
      {anyMatches ? (
        <div className="rec-tier-columns" data-count={positions.length}>
          {columns.map((column) => {
            const showAll = allTierPositions.has(column.position) || deferredQuery.trim() !== '';
            const groups = showAll ? column.groups : column.groups.slice(0, VISIBLE_TIERS);
            const hiddenTiers = column.groups.length - groups.length;
            if (column.groups.length === 0) return null;
            return (
              <div key={column.position} className="rec-tier-column">
                <h2 className="rec-tier-title"><PositionTag position={column.position} />{POSITION_NAMES[column.position]}</h2>
                {column.exhaustedTiers.length > 0 && !showDrafted ? (
                  <p className="rec-tier-exhausted">
                    {column.activeTier === null
                      ? 'All tiers are drafted.'
                      : `Tier ${column.exhaustedTiers.join(', ')} drafted. Showing Tier ${String(column.activeTier)} onward.`}
                  </p>
                ) : null}
                {groups.map((group) => renderGroup(group, column.position))}
                {hiddenTiers > 0 || allTierPositions.has(column.position) ? (
                  <button type="button" className="rec-text-button rec-tier-more" onClick={() => { setAllTierPositions((current) => toggle(current, column.position)); }}>
                    {allTierPositions.has(column.position) ? 'Show fewer tiers' : `Show ${String(hiddenTiers)} more tiers`}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="rec-empty" role="status">No matching players. Clear the search or choose another position.</p>
      )}
    </section>
  );
}
