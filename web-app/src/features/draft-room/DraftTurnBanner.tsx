import * as React from 'react';
import { CheckCircle2, Clock, Lock } from 'lucide-react';
import { getKeeperPickNumber } from '@fantasy-draft/shared/draft';
import { useDraftState } from '@/workspace/WorkspaceProvider';
import { useDraftView } from '@/workspace/useDraftView';
import { cn } from '@/lib/utils';
import { describeTurnStatus, getTurnAnnouncement, getTurnKey, getTurnStatus, type TurnStatus } from './turn-status';
import { useTurnStartPulse } from './useTurnStartPulse';

/** The manager's turn, keeper-aware: a reserved keeper at the manager's pick is not "on the clock". */
export function useTurnStatus(): TurnStatus | null {
  const config = useDraftState((state) => state.config);
  const sessionMode = useDraftState((state) => state.sessionMode);
  const currentPick = useDraftView((view) => view.currentPick);
  const keepers = useDraftView((view) => view.effectiveKeepers);
  // Memoized on its inputs: the banner's announcement effect depends on this object, so a new one every render
  // would re-run it on every unrelated store update.
  return React.useMemo(() => {
    if (sessionMode === 'setup') return null;
    const myTeamIndex = config.myPickPosition - 1;
    const keeper = keepers.find((candidate) => candidate.teamIndex === myTeamIndex &&
      getKeeperPickNumber(candidate, config.totalTeams, config.draftType) === currentPick);
    return getTurnStatus({
      currentPick,
      myPickPosition: config.myPickPosition,
      totalTeams: config.totalTeams,
      totalRounds: config.totalRounds,
      draftType: config.draftType,
      keeperAtCurrentPick: keeper?.playerName ?? null,
    });
  }, [config.draftType, config.myPickPosition, config.totalRounds, config.totalTeams, currentPick, keepers, sessionMode]);
}

/** Polite announcement of turn changes only (on the clock, keeper slot, picks or draft complete). */
function useTurnAnnouncement(status: TurnStatus): string {
  const previous = React.useRef<string | null>(null);
  const [announcement, setAnnouncement] = React.useState('');
  React.useEffect(() => {
    const next = getTurnAnnouncement(previous.current, status);
    previous.current = getTurnKey(status);
    if (next !== null) setAnnouncement(next);
    else if (status.kind === 'waiting') setAnnouncement('');
  }, [status]);
  return announcement;
}

const ICONS = { 'on-clock': Clock, keeper: Lock, 'my-picks-done': CheckCircle2, complete: CheckCircle2, waiting: null } as const;

/**
 * The loudest element on screen when it is your pick: the board's on-clock warning fill, the pick label,
 * and the board's turn-start ring. Waiting stays visible but calm. `compact` fits the side panel's status row.
 */
export function DraftTurnBanner({ variant = 'header', showPick = true, className }: {
  readonly variant?: 'header' | 'compact';
  /** False where the current pick is already on screen beside the banner (the Assistant, under the app header). */
  readonly showPick?: boolean;
  readonly className?: string;
}): React.ReactElement | null {
  const status = useTurnStatus();
  return status ? <TurnBanner status={status} variant={variant} showPick={showPick} className={className} /> : null;
}

function TurnBanner({ status, variant, showPick, className }: {
  readonly status: TurnStatus;
  readonly variant: 'header' | 'compact';
  readonly showPick: boolean;
  readonly className?: string;
}): React.ReactElement {
  const ref = React.useRef<HTMLDivElement>(null);
  useTurnStartPulse(ref, status.kind === 'on-clock' ? status.overallPick : null);
  const announcement = useTurnAnnouncement(status);
  const described = describeTurnStatus(status);
  const headline = described.headline;
  // On the clock the detail is only the pick; a keeper's detail (who fills the slot) always stays.
  const detail = showPick || status.kind !== 'on-clock' ? described.detail : null;
  const Icon = ICONS[status.kind];
  return (
    <div ref={ref} data-state={status.kind} data-variant={variant} className={cn('draft-turn-banner', className)}>
      {Icon ? <Icon className="draft-turn-banner-icon" aria-hidden="true" /> : null}
      <span className="draft-turn-banner-text">
        <strong>{headline}</strong>
        {detail ? <span>{detail}</span> : null}
      </span>
      <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
    </div>
  );
}
