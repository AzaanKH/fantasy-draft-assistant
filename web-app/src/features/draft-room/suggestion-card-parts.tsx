import * as React from 'react';
import type { Player } from '@fantasy-draft/shared/league';
import type { Recommendation } from '@fantasy-draft/shared/draft';
import { ArrowRight, Check, Info, ListPlus } from 'lucide-react';
import { getInjuryDetail, InjuryTag, RiskChip, StatusChip } from '@/components/InjuryTag';
import { Button } from '@/components/ui/button';
import { PositionLabel } from '@/components/PositionLabel';
import type { DraftActionStatus } from '@/hooks/useDraftPlayerAction';
import { formatAdp, formatPositionRank, getInjuryTag, getPlayerAdp } from '@/lib/player-status';
import { describeMissingAvailability, formatAvailabilityPercent, getNextPickAvailability, type NextPickAvailability } from '@/lib/next-pick-availability';
import { getPlayerRisk } from '@/lib/player-risk';
import { cn } from '@/lib/utils';
import type { PoolEnterAction } from './pool-keyboard';
import type { GapToTop } from './suggestion-separation';
import { useSuggestionShortcutScope } from './suggestion-shortcut-preference';
import {
  getPlainSuggestionSummaryParts,
  getRecommendationVerdict,
  VERDICT_RULE,
  type PlainSuggestionSummary,
  type PositionRun,
  type ReasonChip,
  type TakeOrWaitVerdict,
} from './suggestion-reasons';

/** Card geometry shared by loaded and loading suggestions. */
export const CARD = 'flex min-w-0 flex-col rounded-xl border border-border/70 bg-card p-3 shadow-xs';
/** Assistant layout: one compact ranked row per suggestion, identity left, availability and actions right. */
export const ROW_CARD = 'suggestion-row';
export const HEADSHOT = 'size-14 rounded-lg border border-border/70';
export const ROW_HEADSHOT = 'suggestion-headshot rounded-md border border-border/70';
export const NAME = 'mt-1 truncate text-sm font-bold';
export const FACTS = 'mt-3 flex flex-wrap gap-1.5 text-2xs tabular-nums';
export const FACT = 'rounded-md bg-muted/55 px-2 py-1 font-mono';
export const ACTIONS = 'mt-auto flex gap-2 pt-3';

export interface SuggestionCardProps {
  readonly recommendation: Recommendation;
  readonly rank: number;
  /** 1-4: the number key that acts on this card. */
  readonly shortcut: number;
  readonly player?: Player;
  readonly action: PoolEnterAction;
  /** On the clock in a mock, but the roster holds this position's maximum. */
  readonly positionFull: boolean;
  /** Value gap to #1 (to #2 on #1 itself); null without value. */
  readonly gap: GapToTop | null;
  /** A run of recent picks at this card's position, when there is one. */
  readonly run: PositionRun | null;
  readonly reasons: readonly ReasonChip[];
  /**
   * The card's line, chosen across the list so it states a fact no other card does (separateSuggestionSummaries).
   * Omitted, the card words its own first two facts.
   */
  readonly summary?: PlainSuggestionSummary | null;
  /**
   * Assistant list: the first card is the leader (the largest row and the list's one filled action), and the chips
   * are chosen across the list so each sets its card apart (selectCardSignals). Omitted, a card shows its own.
   */
  readonly lead?: boolean;
  readonly signals?: { readonly showVerdict: boolean; readonly flag: CardFlag | null };
  /** Another pick is saving somewhere in the workspace; Draft and Record wait for it. */
  readonly pickInFlight: boolean;
  readonly isQueued: boolean;
  readonly isSelected: boolean;
  readonly draftStatus: DraftActionStatus | undefined;
  readonly onDraft: (player: Player) => void;
  readonly onRecord: (playerId: string) => void;
  readonly onToggleQueue: (playerId: string) => void;
  readonly onExplain: (playerId: string) => void;
  /** Assistant only: makes the card itself the control that picks the analysis subject. */
  readonly onSelect?: (playerId: string) => void;
}

/** Element ids one card's controls reference each other by. */
export function getSuggestionIds(playerId: string): { readonly name: string; readonly hint: string; readonly error: string; readonly reason: string } {
  const base = `suggestion-${playerId}`;
  return { name: `${base}-name`, hint: `${base}-key`, error: `${base}-error`, reason: `${base}-reason` };
}

/** The one chip a card shows beside its verdict: an injury, then elevated risk, then the top reason. */
export type CardFlag =
  | { readonly kind: 'injury' }
  | { readonly kind: 'risk' }
  | { readonly kind: 'reason'; readonly chip: ReasonChip };

/**
 * Cards show the verdict and at most one more chip, so they scan in a glance; everything else is in the verdict's
 * Details tooltip. Tier ends is never the flag: the card's line already says "Last WR in Tier 2". Low risk is never
 * shown, only elevated or high.
 */
export function getCardFlag(player: Player | undefined, reasons: readonly ReasonChip[]): CardFlag | null {
  if (player && getInjuryTag(player.newsStatus)) return { kind: 'injury' };
  const risk = player ? getPlayerRisk(player) : null;
  if (risk && risk.level !== 'low') return { kind: 'risk' };
  const chip = reasons.find((reason) => reason.key !== 'tier-ends');
  return chip ? { kind: 'reason', chip } : null;
}

/**
 * What a card says about timing, from the recommendation's own estimate only: on the final pick it has none, and
 * the catalog's static figure would show a percentage and a verdict for a next pick that does not exist.
 */
export function useSuggestionCardModel({ recommendation, player, reasons, gap, run, summary: listSummary, signals }: Pick<SuggestionCardProps, 'recommendation' | 'player' | 'reasons' | 'gap' | 'run' | 'summary' | 'signals'>): {
  readonly availability: NextPickAvailability;
  readonly verdict: TakeOrWaitVerdict | null;
  readonly summary: PlainSuggestionSummary | null;
  readonly flag: CardFlag | null;
  /** The card's reasons, risk and injury, gathered into the one keyboard-reachable tooltip. */
  readonly explanationDetails: readonly string[];
} {
  const availability = getNextPickAvailability(recommendation.diagnostics);
  const verdict = getRecommendationVerdict(recommendation);
  const summary = listSummary !== undefined ? listSummary : getPlainSuggestionSummaryParts({ recommendation, gap, run, reasons });
  const flag = signals ? signals.flag : getCardFlag(player, reasons);
  const injuryDetail = player ? getInjuryDetail(player.newsStatus) : null;
  const riskDetail = player ? getPlayerRisk(player)?.detail ?? null : null;
  const explanationDetails = React.useMemo(
    () => [...reasons.map((chip) => `${chip.label}: ${chip.detail}`), ...(riskDetail ? [riskDetail] : []), ...(injuryDetail ? [injuryDetail] : [])],
    [injuryDetail, reasons, riskDetail]
  );
  return { availability, verdict, summary, flag, explanationDetails };
}

/** The flag chip itself, in the cards' one chip style. */
export function CardFlagChip({ flag, player }: { readonly flag: CardFlag | null; readonly player: Player | undefined }): React.ReactElement | null {
  if (!flag) return null;
  if (flag.kind === 'injury') return player ? <InjuryTag status={player.newsStatus} /> : null;
  if (flag.kind === 'risk') return player ? <RiskChip player={player} minimum="elevated" /> : null;
  return <ReasonChips chips={[flag.chip]} />;
}

/** "WR3 · DAL · Bye 7 · ADP 14": the card's facts as one quiet line beside the name, the position in its color. */
export function SuggestionMeta({ recommendation, player }: Pick<SuggestionCardProps, 'recommendation' | 'player'>): React.ReactElement {
  const rest = [
    player?.team,
    player ? `Bye ${String(player.byeWeek)}` : null,
    player ? `ADP ${formatAdp(getPlayerAdp(player))}` : null,
  ].filter((part): part is string => Boolean(part));
  return (
    <span className="suggestion-meta">
      <PositionLabel position={recommendation.position} label={player ? formatPositionRank(player) : recommendation.position} />
      {rest.length > 0 ? ` · ${rest.join(' · ')}` : null}
    </span>
  );
}

/**
 * One line the chips and figures do not already say, with a tooltip that explains exactly what it states. "Full
 * reasoning" opens the analysis's Why tab (the card never grows, so all four stay in view and keys 1-4 keep working).
 */
export function SuggestionReason({ summary, playerName, onFullReasoning }: {
  readonly summary: PlainSuggestionSummary | null;
  readonly playerName: string;
  /** Omitted where the card has its own Why action. */
  readonly onFullReasoning?: () => void;
}): React.ReactElement {
  return (
    <div className="suggestion-reason">
      {summary ? <p title={summary.basis}>{summary.text}</p> : null}
      {onFullReasoning ? (
        <button type="button" className="suggestion-reason-toggle" aria-label={`Full reasoning for ${playerName}`} onClick={onFullReasoning}>
          Full reasoning <ArrowRight className="size-3" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

/**
 * The chance the player is still there at the next pick: the page's only availability figure, on every card so
 * the four compare at a glance.
 */
export function SuggestionAvailability({ availability }: { readonly availability: NextPickAvailability }): React.ReactElement {
  if (availability.kind !== 'estimate') {
    return (
      <div className="suggestion-confidence" data-card-availability="" data-missing="">
        <strong>{describeMissingAvailability(availability)}</strong>
      </div>
    );
  }
  return (
    <div className="suggestion-confidence" data-card-availability="">
      <strong>{formatAvailabilityPercent(availability)}</strong>
      <span>available {availability.pickLabel ? `at ${availability.pickLabel}` : 'at your next pick'}</span>
    </div>
  );
}

/**
 * Injury, risk, ADP and bye for one player: the same pieces and wording on the suggestion cards and the side
 * panel's recommendation, so both surfaces show the same metadata.
 */
export function PlayerStatusFacts({ player, className }: { readonly player: Player; readonly className?: string }): React.ReactElement {
  return (
    <span className={cn('player-status-facts', className)}>
      <InjuryTag status={player.newsStatus} />
      <RiskChip player={player} />
      <span>ADP {formatAdp(getPlayerAdp(player))}</span>
      <span>Bye {String(player.byeWeek)}</span>
    </span>
  );
}

/**
 * Take now / Can wait / Likely available. The chip is the card's one focusable explanation: its tooltip holds the
 * rule plus `details` (reason chips, risk, injury), which the other chips show only as titles. Without a verdict
 * (final pick, no estimate) a card with details keeps a Details trigger, so they stay reachable by keyboard.
 */
export function VerdictChip({ verdict, withReason = true, withRule = true, details = [] }: {
  readonly verdict: TakeOrWaitVerdict | null;
  /** False where the reason is already stated beside the chip, so it is not read twice. */
  readonly withReason?: boolean;
  /** False inside the suggestion list, which states the rule once for all four cards. */
  readonly withRule?: boolean;
  readonly details?: readonly string[];
}): React.ReactElement | null {
  const list = details.length > 0 ? <ul className="list-disc pl-4">{details.map((detail) => <li key={detail}>{detail}</li>)}</ul> : null;
  if (!verdict) {
    if (!list) return null;
    return (
      <StatusChip tone="neutral" explanation={list} className="suggestion-verdict suggestion-details">
        <Info className="size-3" aria-hidden="true" />
        <span aria-hidden="true">Details</span>
        <span className="sr-only">Details: {details.join(' ')}</span>
      </StatusChip>
    );
  }
  const explanation = <><p>{VERDICT_RULE}</p>{list ? <div className="mt-1.5">{list}</div> : null}</>;
  const spoken = withReason ? `${verdict.label}: ${verdict.reason}.` : `${verdict.label}.`;
  const tone = verdict.kind === 'take-now' ? 'warn' : verdict.kind === 'can-wait' ? 'ok' : 'neutral';
  return (
    <StatusChip tone={tone} explanation={explanation} className="suggestion-verdict">
      <span aria-hidden="true">{verdict.label}</span>
      <span className="sr-only">{withRule ? `${spoken} ${VERDICT_RULE}` : spoken}</span>
    </StatusChip>
  );
}

/** Scannable reasons beside the verdict; each chip's detail is its tooltip and screen-reader text. */
export function ReasonChips({ chips }: { readonly chips: readonly ReasonChip[] }): React.ReactElement | null {
  if (chips.length === 0) return null;
  return (
    <ul className="suggestion-reason-chips" aria-label="Key reasons">
      {chips.map((chip) => (
        <li key={chip.key}>
          <StatusChip tone={chip.tone} title={chip.detail}>
            <span aria-hidden="true">{chip.label}</span>
            <span className="sr-only">{chip.label}: {chip.detail}</span>
          </StatusChip>
        </li>
      ))}
    </ul>
  );
}

/** The tier as the dock tile's pill; ADP and bye are on the meta line, and the card's line compares the cards. */
export function SuggestionFacts({ diagnostics }: { readonly diagnostics: Recommendation['diagnostics'] }): React.ReactElement {
  return (
    <dl className={FACTS}>
      <div className={FACT}>
        <dt className="sr-only">Tier</dt>
        <dd>Tier {String(diagnostics?.tier ?? '—')} · {String(diagnostics?.tierRemaining ?? '—')} left</dd>
      </div>
    </dl>
  );
}

/** Whether the card has a Draft or Record action; without one, Queue becomes the card's primary action. */
export function hasPrimaryAction({ action, player, positionFull }: Pick<SuggestionCardProps, 'action' | 'player' | 'positionFull'>): boolean {
  return (action === 'draft' && player !== undefined) || action === 'record' || positionFull;
}

/** Draft on your turn in a mock, Record pick during Manual Continuity, or a disabled Draft at the position limit. */
export function SuggestionPrimaryAction({ recommendation, player, action, positionFull, pickInFlight, draftStatus, onDraft, onRecord, quiet = false }: Pick<
  SuggestionCardProps, 'recommendation' | 'player' | 'action' | 'positionFull' | 'pickInFlight' | 'draftStatus' | 'onDraft' | 'onRecord'
> & {
  /** Outlined, for every card but the list's leader: one filled action per list, so the eye lands on it first. */
  readonly quiet?: boolean;
}): React.ReactElement | null {
  const name = recommendation.playerName;
  const resting = quiet ? 'outline' : 'default';
  if (action === 'draft' && player) {
    const state = draftStatus?.state;
    return (
      <Button size="sm" className="flex-1" variant={state === 'failed' ? 'destructive' : resting}
        disabled={state === 'pending' || pickInFlight} aria-busy={state === 'pending' || undefined}
        aria-describedby={state === 'failed' ? getSuggestionIds(recommendation.playerId).error : undefined}
        aria-label={state === 'failed' ? `Retry drafting ${name}` : `Draft ${name}`}
        onClick={() => { onDraft(player); }}>
        {state === 'pending' ? 'Saving…' : state === 'failed' ? 'Retry draft' : 'Draft'}
      </Button>
    );
  }
  if (action === 'record') {
    return (
      <Button size="sm" className="flex-1" variant={resting} disabled={pickInFlight} aria-label={`Record ${name} as a provisional pick`} onClick={() => { onRecord(recommendation.playerId); }}>
        Record pick
      </Button>
    );
  }
  if (positionFull) {
    return <Button size="sm" className="flex-1" variant={resting} disabled title={`${recommendation.position} limit reached`} aria-label={`Draft ${name}`}>Draft</Button>;
  }
  return null;
}

/** Queue toggle: the primary action when the card has no Draft or Record; otherwise secondary (an icon, on a row). */
export function SuggestionQueueButton({ playerId, name, isQueued, primary, compact, quiet = false, onToggleQueue }: {
  readonly playerId: string;
  readonly name: string;
  readonly isQueued: boolean;
  readonly primary: boolean;
  /** The Assistant row shows the secondary Queue as an icon button. */
  readonly compact: boolean;
  /** Outlined even as the card's primary action: only the list's leader gets the filled button. */
  readonly quiet?: boolean;
  readonly onToggleQueue: (playerId: string) => void;
}): React.ReactElement {
  const iconOnly = compact && !primary;
  return (
    <Button variant={isQueued ? 'secondary' : primary && !quiet ? 'default' : 'outline'} size={iconOnly ? 'icon-sm' : 'sm'} className={primary ? 'flex-1' : undefined}
      aria-pressed={isQueued}
      aria-label={isQueued ? `Remove ${name} from queue` : `Add ${name} to queue`}
      title={iconOnly ? (isQueued ? 'Remove from queue' : 'Add to queue') : undefined}
      onClick={() => { onToggleQueue(playerId); }}>
      {isQueued ? <Check className="size-4" /> : <ListPlus className="size-4" />}
      {iconOnly ? null : isQueued ? 'Queued' : 'Queue'}
    </Button>
  );
}

/** The card's number key; its title follows the manager's shortcut preference. */
export function SuggestionKeyHint({ id, shortcut }: { readonly id: string; readonly shortcut: number }): React.ReactElement {
  const [scope] = useSuggestionShortcutScope();
  const key = String(shortcut);
  return (
    <kbd id={id} className="suggestion-key" title={scope === 'anywhere' ? `Press ${key} on the clock, or with the suggestion list focused` : `Press ${key} with the suggestion list focused`}>
      <span className="sr-only">Shortcut key </span>{key}
    </kbd>
  );
}

/** This card's failed Draft, announced once; the Draft button becomes Retry and references it. */
export function SuggestionError({ playerId, draftStatus }: { readonly playerId: string; readonly draftStatus: DraftActionStatus | undefined }): React.ReactElement | null {
  if (draftStatus?.state !== 'failed') return null;
  return <p id={getSuggestionIds(playerId).error} role="alert" className="suggestion-error mt-2 text-xs font-semibold text-danger">{draftStatus.message}</p>;
}
