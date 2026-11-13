import * as React from 'react';
import { describeMissingAvailability, formatAvailabilityPercent, type NextPickAvailability } from '@/lib/next-pick-availability';
import type { Player } from '@fantasy-draft/shared/league';
import { formatSignedNumber } from '@fantasy-draft/shared/draft';
import { Check, ListPlus } from 'lucide-react';
import { getInjuryDetail, InjuryTag, RiskChip } from '@/components/InjuryTag';
import { PlayerHeadshot } from '@/components/PlayerHeadshot';
import { PositionLabel } from '@/components/PositionLabel';
import { SkeletonBlock, SkeletonText } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { formatTierScarcity, SCARCE_TIER_REMAINING } from '@/features/assistant/assistant-tiers';
import type { DraftActionStatus } from '@/hooks/useDraftPlayerAction';
import { formatAdp, formatPositionRank, getPlayerAdp } from '@/lib/player-status';
import { getPlayerRisk } from '@/lib/player-risk';
import { cn } from '@/lib/utils';
import { POOL_ACTIVE_HINT_ID, poolCellId, poolRowId } from './usePoolKeyboard';

/**
 * Optional columns, in the order they appear. `data-col` lets draft-design.css drop them by priority
 * as the pool narrows (Bye first, then Pos, vs ADP, and ADP / Injury last). Proj, the season projection, is
 * not optional and stays at every width.
 */
export const OPTIONAL_POOL_COLUMNS = ['pos', 'adp', 'bye', 'inj', 'vsadp'] as const;

/** Draft button label and state for this row's pending or failed save. */
function DraftButton({ player, canDraft, positionFull, status, onDraft }: {
  readonly player: Player;
  readonly canDraft: boolean;
  readonly positionFull: boolean;
  readonly status: DraftActionStatus['state'] | undefined;
  readonly onDraft: (player: Player) => void;
}): React.ReactElement {
  const errorId = `${poolRowId(player.id)}-draft-error`;
  return (
    <Button size="sm" className="draft-pill-action" disabled={!canDraft || positionFull || status === 'pending'}
      variant={status === 'failed' ? 'destructive' : 'default'}
      aria-busy={status === 'pending' || undefined}
      aria-describedby={status === 'failed' ? errorId : undefined}
      title={canDraft && positionFull ? `${player.position} limit reached` : undefined}
      aria-label={status === 'failed' ? `Retry drafting ${player.name}` : `Draft ${player.name}`}
      onClick={() => { onDraft(player); }}>
      {status === 'pending' ? 'Saving…' : status === 'failed' ? 'Retry' : 'Draft'}
    </Button>
  );
}

/** Memoized: the virtualized pool re-renders on every scroll, but a row only changes with its own props. */
export const DraftPlayerPoolRow = React.memo(function DraftPlayerPoolRow({
  player,
  canDraft,
  positionFull,
  showDraftAction,
  isQueued,
  rank,
  rankLabel,
  rowIndex,
  availability,
  tierRemaining,
  draftStatus,
  isActive,
  onDraft,
  onToggleQueue,
}: {
  readonly player: Player;
  readonly canDraft: boolean;
  /** The roster already holds the position's maximum. */
  readonly positionFull: boolean;
  readonly showDraftAction: boolean;
  readonly isQueued: boolean;
  readonly rank: number | undefined;
  readonly rankLabel: string;
  readonly rowIndex: number;
  /** Next-pick availability from the shared helper: an estimate, not estimated, or no later pick. */
  readonly availability: NextPickAvailability;
  /** Available players left in this player's position tier, including the player. */
  readonly tierRemaining: number | undefined;
  /** Set only when this row started a Draft that is saving or failed. */
  readonly draftStatus: DraftActionStatus | undefined;
  /** Highlighted by keyboard navigation. */
  readonly isActive: boolean;
  readonly onDraft: (player: Player) => void;
  readonly onToggleQueue: (playerId: string) => void;
}): React.ReactElement {
  const adp = getPlayerAdp(player);
  // The row's chips explain themselves with titles only (no tab stop per row): keyboard and screen-reader users get
  // the same injury and risk detail as the player cell's description.
  const risk = getPlayerRisk(player);
  const statusDetail = [getInjuryDetail(player.newsStatus), risk && risk.level !== 'low' ? risk.detail : null].filter((detail): detail is string => detail !== null).join('. ');
  const statusId = `${poolRowId(player.id)}-status`;
  const describedBy = [isActive ? POOL_ACTIVE_HINT_ID : null, statusDetail ? statusId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div role="row" aria-rowindex={rowIndex} data-player-row data-active={isActive || undefined} id={poolRowId(player.id)} className="draft-pool-row draft-pool-columns">
      {showDraftAction ? (
        <div role="gridcell" className="draft-pool-action">
          <DraftButton player={player} canDraft={canDraft} positionFull={positionFull} status={draftStatus?.state} onDraft={onDraft} />
          {draftStatus?.state === 'failed' ? <span id={`${poolRowId(player.id)}-draft-error`} role="alert" className="sr-only">{draftStatus.message}</span> : null}
        </div>
      ) : null}
      <div role="gridcell" className="draft-pool-rank">
        {rank === undefined ? <span aria-label={`Not ranked by ${rankLabel}`}>–</span> : String(rank)}
      </div>
      <div role="gridcell" id={poolCellId(player.id)} aria-describedby={describedBy} className="draft-pool-player">
        {statusDetail ? <span id={statusId} hidden>{statusDetail}</span> : null}
        <PlayerHeadshot playerId={player.id} name={player.name} position={player.position} team={player.team} className="size-7 shrink-0 rounded-full text-2xs" />
        <div className="min-w-0">
          <div className="draft-pool-name-line">
            <div className="draft-pool-name" title={player.name}>{player.name}</div>
            <RiskChip player={player} minimum="elevated" />
          </div>
          <div className="draft-pool-meta">
            <PositionLabel position={player.position} /> · {player.team}<span className="draft-pool-meta-bye"> · Bye {String(player.byeWeek)}</span>
            {tierRemaining !== undefined && player.tier > 0 ? (
              <> · <span className="draft-pool-scarcity" data-scarce={tierRemaining <= SCARCE_TIER_REMAINING || undefined}>
                {formatTierScarcity(player.position, player.tier, tierRemaining)}
              </span></>
            ) : null}
          </div>
        </div>
      </div>
      <div role="gridcell" data-col="pos" className="draft-pool-extra draft-pool-number">{formatPositionRank(player)}</div>
      <div role="gridcell" data-col="adp" className="draft-pool-extra draft-pool-number">{formatAdp(adp)}</div>
      <div role="gridcell" data-col="bye" className="draft-pool-extra draft-pool-number">{String(player.byeWeek)}</div>
      <div role="gridcell" data-col="inj" className="draft-pool-extra draft-pool-status"><InjuryTag status={player.newsStatus} placeholder="—" /></div>
      <div role="gridcell" data-col="vsadp" className={cn('draft-pool-extra draft-pool-number', player.valueScore >= 5 ? 'is-value' : player.valueScore <= -5 ? 'is-reach' : undefined)}>
        {adp === null ? '—' : formatSignedNumber(player.valueScore, 0)}
      </div>
      <div role="gridcell" data-col="proj" className="draft-pool-number">{Number.isFinite(player.projectedPoints) ? String(Math.round(player.projectedPoints)) : '—'}</div>
      <div role="gridcell" className="draft-pool-number">{formatSignedNumber(player.valueOverReplacement, 0)}</div>
      <div role="gridcell" className="draft-pool-number" title={describeMissingAvailability(availability) ?? undefined}>
        {formatAvailabilityPercent(availability)}
        {availability.kind === 'estimate' ? null : <span className="sr-only">{describeMissingAvailability(availability)}</span>}
      </div>
      <div role="gridcell" className="draft-pool-action">
        <Button variant={isQueued ? 'secondary' : 'ghost'} size="icon-sm" className="rounded-sm"
          aria-label={isQueued ? `Remove ${player.name} from queue` : `Add ${player.name} to queue`}
          aria-pressed={isQueued} onClick={() => { onToggleQueue(player.id); }}>
          {isQueued ? <Check className="size-4" /> : <ListPlus className="size-4" />}
        </Button>
      </div>
    </div>
  );
});

/** Name and meta lines while loading. They copy the line boxes of .draft-pool-name and .draft-pool-meta, not the classes, which browser drivers read names from. */
export function PlayerLinesPlaceholder(): React.ReactElement {
  return (
    <div className="min-w-0 flex-1">
      <div className="text-sm leading-5"><SkeletonText className="w-32" /></div>
      <div className="text-xs leading-4"><SkeletonText className="w-24" /></div>
    </div>
  );
}

/** A loading row in the pool's own row grid. */
export function DraftPlayerRowPlaceholder({ showDraftAction }: { readonly showDraftAction: boolean }): React.ReactElement {
  return (
    <div role="row" aria-hidden="true" className="draft-pool-row draft-pool-columns">
      {showDraftAction ? <div className="draft-pool-action"><SkeletonBlock className="h-8 w-16 rounded-sm" /></div> : null}
      <div className="draft-pool-rank"><SkeletonText className="w-5" /></div>
      <div className="draft-pool-player">
        <SkeletonBlock className="size-7 shrink-0 rounded-full" />
        <PlayerLinesPlaceholder />
      </div>
      {OPTIONAL_POOL_COLUMNS.map((column) => (
        <div key={column} data-col={column} className="draft-pool-extra draft-pool-number"><SkeletonText className="w-6" /></div>
      ))}
      <div className="draft-pool-number"><SkeletonText className="w-6" /></div>
      <div className="draft-pool-number"><SkeletonText className="w-6" /></div>
      <div className="draft-pool-number"><SkeletonText className="w-8" /></div>
      <div className="draft-pool-action"><SkeletonBlock className="size-8 rounded-sm" /></div>
    </div>
  );
}
