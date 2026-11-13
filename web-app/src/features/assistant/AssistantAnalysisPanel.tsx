import * as React from 'react';
import {
  formatSignedNumber,
  getWaitingCostSummary,
  type DecisionLens,
  type DraftDecisionView,
  type PositionNeed,
  type Recommendation,
} from '@fantasy-draft/shared/draft';
import type { Player } from '@fantasy-draft/shared/league';
import type { DraftProvider } from '@fantasy-draft/shared/sync';
import { PositionTag } from '@/components/PositionTag';
import { useSubjectFade } from '@/components/motion';
import { VerdictChip } from '@/features/draft-room/suggestion-card-parts';
import { FINAL_PICK_NOTE, getRecommendationVerdict } from '@/features/draft-room/suggestion-reasons';
import { MetricHelp } from '@/features/help/MetricHelp';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { describeMissingAvailability, formatAvailabilityPercent, getNextPickAvailability, type NextPickAvailability } from '@/lib/next-pick-availability';
import { getPlayerRisk } from '@/lib/player-risk';
import { formatAdp, getInjuryTag, getPlayerAdp } from '@/lib/player-status';
import { AnalysisTabs, type AnalysisTab } from './AssistantLayout';
import { CompareAnswer } from './AssistantComparison';
import { RosterAnswer, WhyAnswer } from './AssistantAnswers';
import type { AssistantDraftMode } from './assistant-context';
import { MISSING_SELECTION_NOTICE } from './assistant-navigation';
import type { AnalysisSubject } from './useAssistantSubject';
import { ViewedPlayerAction } from './ViewedPlayerAction';

export type { LensDivergence } from './useAssistantSubject';

/** What this player fills on your roster, in words, from this position's own open starter and FLEX slots. */
export function describeRosterFit(need: PositionNeed | undefined): string {
  if (need && need.startersFilled < need.startersNeeded) {
    return `${String(need.startersNeeded - need.startersFilled)} of ${String(need.startersNeeded)} ${need.position} ${need.startersNeeded === 1 ? 'starter spot' : 'starter spots'} open`;
  }
  if (need?.isFlexEligible && need.flexSlotsFilled < need.flexSlotsNeeded) {
    return `${String(need.flexSlotsNeeded - need.flexSlotsFilled)} of ${String(need.flexSlotsNeeded)} FLEX ${need.flexSlotsNeeded === 1 ? 'spot' : 'spots'} open`;
  }
  return 'Bench depth';
}

/** What the fallback's points mean, said once beside the number. */
const FALLBACK_BASIS = 'Expected points over a fill-in starter at this position, weighted by the chance he is still there at your next pick.';

/**
 * Take now or wait, for the subject: only what the cards do not already show. The card owns availability; this block
 * adds the verdict's reason, what waiting costs, who is likely left if you wait, roster fit and risk. Dense on
 * purpose (verdict and reason on one line, two facts per row) so the tab answer below keeps room on a laptop.
 */
function TakeOrWait({ recommendation, player, needs }: {
  readonly recommendation: Recommendation;
  readonly player: Player | undefined;
  readonly needs: readonly PositionNeed[];
}): React.ReactElement {
  const verdict = getRecommendationVerdict(recommendation);
  const waiting = getWaitingCostSummary(recommendation);
  const finalPick = getNextPickAvailability(recommendation.diagnostics).kind === 'no-next-pick';
  const at = waiting.nextPickLabel ?? 'your next pick';
  const fit = recommendation.decisionFactors?.rosterFit;
  const risk = player ? getPlayerRisk(player) : null;
  const injury = player ? getInjuryTag(player.newsStatus) : null;
  const notEstimated = <span className="rec-unknown">Not estimated</span>;
  return (
    <section className="rec-decision" aria-label="Take now or wait" data-decision-subject={recommendation.playerId}>
      <h3 className="sr-only">Take now or wait?</h3>
      {verdict ? (
        <div className="rec-decision-head">
          <VerdictChip verdict={verdict} withReason={false} />
          <p className="rec-decision-reason">{verdict.reason.charAt(0).toUpperCase() + verdict.reason.slice(1)}.</p>
        </div>
      ) : null}
      <dl className="rec-decision-facts">
        {finalPick ? null : (
          <div>
            <dt><MetricHelp metric="waitingCost" label="Cost of waiting" /></dt>
            <dd data-waiting-cost="">{waiting.costOfWaiting === null ? notEstimated : `${waiting.costOfWaiting.toFixed(1)} pts`}</dd>
          </div>
        )}
        <div>
          <dt>Risk</dt>
          <dd data-risk="" title={risk?.detail}>{[injury?.label, risk?.label].filter(Boolean).join(' · ') || notEstimated}</dd>
        </div>
        <div className="rec-decision-wide">
          <dt>Roster fit</dt>
          <dd data-roster-fit="">{fit ? describeRosterFit(needs.find((need) => need.position === recommendation.position)) : notEstimated}</dd>
        </div>
        {/* Its own full row and allowed to wrap, so a long fallback name is never cut off. */}
        <div className="rec-decision-wide rec-decision-fallback">
          <dt>{finalPick ? 'Timing' : `If you wait, at ${at}`}</dt>
          <dd data-fallback="">
            {finalPick
              ? FINAL_PICK_NOTE
              : waiting.costOfWaiting === null
                ? notEstimated
                : waiting.fallbackName
                  ? <><strong>{waiting.fallbackName}</strong> <span className="rec-muted" title={FALLBACK_BASIS}>{formatSignedNumber(waiting.fallbackValue ?? 0, 0)} pts<span className="sr-only"> over a fill-in starter</span></span></>
                  : `No ${recommendation.position} projected to be left`}
          </dd>
        </div>
      </dl>
    </section>
  );
}

/**
 * A player the model does not analyse for this pick (deeper than its lists): what is still known, in the same block,
 * so the panel keeps its shape. Draft and Queue above still work.
 */
function LimitedAnalysis({ name, depth, player, availability }: {
  readonly name: string;
  readonly depth: number;
  readonly player: Player | undefined;
  readonly availability: NextPickAvailability;
}): React.ReactElement {
  const missing = describeMissingAvailability(availability);
  return (
    <section className="rec-decision" aria-label="Limited analysis" data-limited="">
      <p role="status" className="rec-decision-reason">
        <strong>Limited analysis.</strong> {name} isn&apos;t in the model&apos;s top {String(depth)} for this pick, so there&apos;s no take-or-wait estimate. You can still draft or queue him.
      </p>
      <dl className="rec-decision-facts">
        <div>
          <dt>Chance he&apos;s there</dt>
          <dd>{missing ? <span className="rec-unknown">{missing}</span> : formatAvailabilityPercent(availability)}</dd>
        </div>
        <div>
          <dt>ADP</dt>
          <dd>{player ? formatAdp(getPlayerAdp(player)) : '—'}</dd>
        </div>
        <div>
          <dt>Rankings</dt>
          <dd>{player ? `#${String(player.ecrRank)}` : '—'}</dd>
        </div>
        <div>
          <dt>Bye</dt>
          <dd>{player?.byeWeek ? String(player.byeWeek) : '—'}</dd>
        </div>
      </dl>
    </section>
  );
}

/**
 * The header line has room for one alert. The first (most important) is shown; any others sit behind a focusable
 * "+N more" whose tooltip lists them, and whose accessible name reads them, so no alert vanishes off the line.
 */
export function AnalysisAlerts({ alerts }: { readonly alerts: readonly string[] }): React.ReactElement | null {
  const [primary, ...hidden] = alerts;
  if (primary === undefined) return null;
  return (
    <>
      <span className="rec-alert rec-alert-primary" title={primary}>{primary}</span>
      {hidden.length > 0 ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="rec-alert rec-alert-more" data-alert-more="">
              <span aria-hidden="true">+{String(hidden.length)} more</span>
              <span className="sr-only">{`${String(hidden.length)} more alert${hidden.length === 1 ? '' : 's'}: ${hidden.join('. ')}`}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" aria-hidden="true">
            <ul className="rec-alert-list">{hidden.map((alert) => <li key={alert}>{alert}</li>)}</ul>
          </TooltipContent>
        </Tooltip>
      ) : null}
    </>
  );
}

/** "Best Pick · #1", "Viewing · #14 overall", or "Not in top 60". */
function subjectLabel(subject: AnalysisSubject, lens: DecisionLens): string {
  if (subject.isLeader) return `${lens === 'best-pick' ? 'Best Pick' : 'Best Player'} · #1`;
  if (subject.rank !== undefined) return `Viewing · #${String(subject.rank)} overall`;
  return `Viewing · not in top ${String(subject.modelDepth)}`;
}

/**
 * The Assistant's single analysis area. Selecting a card, tier row or list row changes its subject; identity,
 * take-now-or-wait, the expected fallback, the reasoning and the mode-aware action all describe that one player.
 */
export interface AssistantAnalysisPanelProps {
  readonly subject: AnalysisSubject;
  readonly lens: DecisionLens;
  readonly tab: AnalysisTab;
  readonly onTabChange: (tab: AnalysisTab) => void;
  readonly onViewPlayer: (playerId: string) => void;
  readonly onComparisonPlayerChange: (playerId: string) => void;
  readonly onQueue: (playerId: string) => void;
  /** `quietAction`: the suggestion cards are on screen, and their leader holds the page's one filled action. */
  readonly draft: { readonly mode: AssistantDraftMode; readonly provider: DraftProvider | null; readonly nextPickLabel: string | null; readonly quietAction?: boolean };
  readonly decision: DraftDecisionView;
  readonly playerById: ReadonlyMap<string, Player>;
  readonly needs: readonly PositionNeed[];
}

export const AssistantAnalysisPanel = React.forwardRef<HTMLElement, AssistantAnalysisPanelProps>(function AssistantAnalysisPanel({
  subject,
  lens,
  tab,
  onTabChange,
  onViewPlayer,
  onComparisonPlayerChange,
  onQueue,
  draft,
  decision,
  playerById,
  needs,
}, ref): React.ReactElement {
  const { viewed, player, alerts, divergence } = subject;
  const recommendation = viewed.kind === 'recommendation' ? viewed.recommendation : undefined;
  const name = viewed.kind === 'recommendation' ? viewed.recommendation.playerName : viewed.kind === 'unavailable' ? viewed.playerName : null;
  const position = viewed.kind === 'recommendation' ? viewed.recommendation.position : viewed.kind === 'unavailable' ? viewed.position : null;
  // The Roster tab owns the bye-week overlap, so the header drops that alert while it is open.
  const visibleAlerts = tab === 'roster' ? alerts.filter((alert) => !alert.startsWith('Bye ')) : alerts;
  const subjectKey = recommendation?.playerId ?? (viewed.kind === 'unavailable' ? viewed.playerId : 'none');
  const sectionRef = React.useRef<HTMLElement | null>(null);
  const setSectionRef = React.useCallback((element: HTMLElement | null) => {
    sectionRef.current = element;
    if (typeof ref === 'function') ref(element);
    else if (ref) ref.current = element;
  }, [ref]);
  useSubjectFade(sectionRef, subjectKey);
  // Drafted subjects can be neither drafted nor queued again; every available subject, analysed or not, can.
  const actionable = viewed.kind === 'recommendation' || (viewed.kind === 'unavailable' && viewed.reason === 'unranked');

  return (
    <section ref={setSectionRef} className="rec-analysis" aria-label="Viewed player analysis" tabIndex={-1} data-subject={subjectKey}>
      {/* One short sentence when the viewed player changes, instead of re-reading the whole analysis. */}
      <p className="sr-only" aria-live="polite">{name ? `Showing analysis for ${name}` : ''}</p>
      {name && position ? (
        // Name, position and team, with Draft and Queue on the same line: the answer below keeps its room.
        <header className="rec-analysis-identity">
          <div className="rec-analysis-title">
            <h2 className="rec-analysis-name">{name}</h2>
            <span className="rec-meta">
              <PositionTag position={position} />
              {player?.team ? <span>{player.team}</span> : null}
            </span>
          </div>
          <ViewedPlayerAction
            player={actionable ? player : undefined}
            playerName={name}
            mode={draft.mode}
            provider={draft.provider}
            nextPickLabel={draft.nextPickLabel}
            isQueued={subject.isQueued}
            quiet={draft.quietAction}
            onQueue={actionable && player ? onQueue : undefined}
          />
          <p className="rec-analysis-sub">
            {subject.missingSelection ? <span className="rec-missing-selection" role="status" data-missing-selection="">{MISSING_SELECTION_NOTICE}</span> : null}
            <span className="rec-card-label">{subjectLabel(subject, lens)}</span>
            <AnalysisAlerts alerts={visibleAlerts} />
          </p>
        </header>
      ) : null}

      {viewed.kind === 'unavailable' ? (
        viewed.reason === 'drafted' ? (
          <p role="status" className="rec-answer-footnote">{viewed.playerName} has been drafted. Choose an available player to see analysis.</p>
        ) : (
          <LimitedAnalysis name={viewed.playerName} depth={subject.modelDepth} player={player} availability={subject.availability} />
        )
      ) : !recommendation ? (
        <p className="rec-answer-footnote">No available recommendation for this draft state.</p>
      ) : (
        // Unkeyed, like the action above: each is the only one of its kind in this section, so a subject change
        // updates it in place and an old block can never linger beside a new one.
        <TakeOrWait recommendation={recommendation} player={player} needs={needs} />
      )}

      {divergence && subject.isLeader ? (
        // One line: the other lens's leader and a way to view them. The full comparison lives in Compare.
        <div className="rec-divergence" title={divergence.reason ?? undefined}>
          <span className="rec-muted">{divergence.label}:</span>
          <PositionTag position={divergence.position} />
          <strong className="rec-divergence-name">{divergence.playerName}</strong>
          <button type="button" className="rec-text-button" aria-label={`View ${divergence.playerName}, the ${divergence.label}`} onClick={() => { onViewPlayer(divergence.playerId); }}>View</button>
        </div>
      ) : null}

      {recommendation ? (
        <>
          <AnalysisTabs tab={tab} onChange={onTabChange} />
          {/* Scrolls inside the fixed-height column, so switching subjects never changes the column's height. */}
          <div id="rec-analysis-panel" role="tabpanel" aria-labelledby={`rec-tab-${tab}`} className="rec-answer" tabIndex={0}>
            <div key={`${tab}:${recommendation.playerId}`}>
              {tab === 'why' ? (
                <WhyAnswer recommendation={recommendation} isTopPick={subject.isTopPick} preferredExplanation={decision.explanationByPlayerId.get(recommendation.playerId)} expandReasoning={subject.expandReasoning} />
              ) : tab === 'compare' ? (
                <CompareAnswer
                  recommendations={subject.comparison.pair}
                  availableComparisons={subject.comparison.candidates}
                  decision={decision}
                  onComparisonPlayerChange={onComparisonPlayerChange}
                  playerById={playerById}
                />
              ) : (
                <RosterAnswer needs={needs} recommendation={recommendation} player={player} sameByeName={subject.sameByeName} />
              )}
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
});
