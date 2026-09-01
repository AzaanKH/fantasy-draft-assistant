import * as React from 'react';
import {
  Bot,
  Check,
  ChevronLeft,
  ExternalLink,
  GitCompareArrows,
  Lightbulb,
  Radio,
  Scale,
  ShieldCheck,
  Shirt,
  Target,
} from 'lucide-react';
import {
  POSITIONS,
  type DraftProvider,
  type Player,
  type Position,
  type PositionNeed,
  type Recommendation,
} from '@fantasy-draft/shared';
import { PlayerHeadshot } from '@/components/PlayerHeadshot';
import { DecisionSwap, MotionIdentitySwap, MotionMetricSwap } from '@/components/motion';
import { RouteSkeleton } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { getPositionRecommendations } from '@/features/assistant/assistant-position-rankings';
import { getPicksUntilMyTurn } from '@/features/draft-board/on-the-clock-utils';
import { DraftReadinessBlockedNotice } from '@/features/draft-room/DraftReadinessBlockedNotice';
import { ProviderIdentityBlockedNotice } from '@/features/draft-room/ProviderIdentityBlockedNotice';
import { useDraftDecision } from '@/features/recommendations/DraftDecisionContext';
import {
  getPreferredRecommendation,
  getRecommendationPolicyLabel,
  type DraftDecisionView,
} from '@/features/recommendations/draft-decision';
import { getRecommendationExplanation } from '@/features/recommendations/recommendation-explanation';
import { ThemeMenu } from '@/features/theme/ThemeMenu';
import {
  useDraftSync,
  type DraftSyncViewState,
} from '@/hooks/useDraftSync';
import { usePlayerDataQuery } from '@/hooks/usePlayerData';
import { useTeamNeeds } from '@/hooks/useTeamNeeds';
import { formatRoundPick } from '@/lib/mock-draft-engine';
import { cn, formatSignedNumber } from '@/lib/utils';
import { useDraftStore } from '@/stores/draftStore';
import { DraftSyncStatusIndicator } from '@/features/draft-room/DraftSyncStatusIndicator';

type SidePanelView = 'draft' | 'compare' | 'assistant' | 'roster';
type PositionFilter = 'ALL' | Position;
type AssistantLens = 'why' | 'compare' | 'wait' | 'roster';

const POSITION_FILTERS: readonly PositionFilter[] = ['ALL', ...POSITIONS];

interface SidePanelConnection {
  readonly provider: DraftProvider;
  readonly draftId: string | null;
  readonly draftPosition: number | null;
}

function readConnection(): SidePanelConnection {
  const params = new URLSearchParams(window.location.search);
  const providerValue = params.get('provider');
  const provider: DraftProvider = providerValue === 'yahoo' || providerValue === 'sleeper'
    ? providerValue
    : 'espn';
  const draftId = provider === 'yahoo'
    ? params.get('leagueId') ?? params.get('draftId')
    : params.get('draftId') ?? params.get('leagueId');
  const positionValue = Number.parseInt(params.get('position') ?? '', 10);
  const draftPosition = Number.isInteger(positionValue) && positionValue >= 1 && positionValue <= 20
    ? positionValue
    : null;

  return { provider, draftId, draftPosition };
}

function getProviderLabel(provider: DraftProvider): string {
  if (provider === 'yahoo') return 'Yahoo';
  if (provider === 'sleeper') return 'Sleeper';
  return 'ESPN';
}

function getSurvival(recommendation: Recommendation | undefined): number | null {
  const probability = recommendation?.diagnostics?.nextPickSurvivalProbability;
  return probability === undefined ? null : Math.round(probability * 100);
}

function getCompactDecisionExplanation(
  recommendation: Recommendation,
  detailedExplanation: string
): string {
  const diagnostics = recommendation.diagnostics;
  const timing = recommendation.decisionFactors?.draftTiming;
  if (
    diagnostics?.nextPickSurvivalProbability === undefined ||
    timing?.nextPickNumber === undefined
  ) {
    return detailedExplanation;
  }

  const nextPick = timing.nextPickLabel ?? `#${String(timing.nextPickNumber)}`;
  const fallback = timing.expectedAlternative
    ? `${timing.expectedAlternative.playerName} is the expected ${recommendation.position} fallback.`
    : `No same-position fallback is projected.`;
  const changedBestPick = timing.materiallyChangedOrdering
    ? ' That timing tradeoff changed Best Pick.'
    : '';
  return `${recommendation.playerName} is ${formatSignedNumber(diagnostics.valueOverReplacement, 0)} points above replacement with ${String(Math.round(diagnostics.nextPickSurvivalProbability * 100))}% Return Probability at pick ${nextPick}. ${fallback}${changedBestPick}`;
}

function getNeedLabel(need: PositionNeed): string {
  if (need.priority === 'critical') return 'Critical';
  if (need.priority === 'high') return 'High';
  if (need.priority === 'medium') return 'Open';
  return 'Later';
}

function getNeedDescription(need: PositionNeed): string {
  if (need.priority === 'critical' || need.priority === 'high') return 'Need starter';
  if (
    need.priority === 'medium' &&
    need.isFlexEligible &&
    need.flexSlotsFilled < need.flexSlotsNeeded
  ) return 'Open FLEX starter';
  if (need.priority === 'medium') return 'Strong depth';
  return 'Can wait';
}

function getNeedSlotSummary(need: PositionNeed): string {
  const fixedSummary = `${String(need.startersFilled)} of ${String(need.startersNeeded)} fixed starter slots filled`;
  if (!need.isFlexEligible || need.flexSlotsNeeded === 0) return fixedSummary;
  return `${fixedSummary}; ${String(need.flexSlotsFilled)} of ${String(need.flexSlotsNeeded)} FLEX slots filled`;
}

function getPositionTextColor(position: Position): string {
  return {
    QB: 'text-red-500',
    RB: 'text-emerald-600 dark:text-emerald-300',
    WR: 'text-sky-600 dark:text-sky-300',
    TE: 'text-amber-600 dark:text-amber-300',
    K: 'text-violet-600 dark:text-violet-300',
    DEF: 'text-slate-600 dark:text-slate-300',
  }[position];
}

function useSidePanelSync(connection: SidePanelConnection) {
  const setConfig = useDraftStore((state) => state.setConfig);
  const setSessionMode = useDraftStore((state) => state.setSessionMode);
  const sync = useDraftSync(connection.provider, connection.draftId, true);

  React.useEffect(() => {
    if (connection.draftPosition !== null) {
      setConfig({ myPickPosition: connection.draftPosition });
    }
  }, [connection.draftPosition, setConfig]);

  React.useEffect(() => {
    if (sync.draft) setSessionMode('live');
  }, [setSessionMode, sync.draft]);

  return sync;
}

function PositionFilters({
  value,
  onChange,
}: {
  readonly value: PositionFilter;
  readonly onChange: (position: PositionFilter) => void;
}): React.ReactElement {
  return (
    <div
      className="grid grid-cols-7 overflow-hidden rounded-xl border border-border/80 bg-card shadow-xs"
      role="group"
      aria-label="Filter recommendations by position"
    >
      {POSITION_FILTERS.map((position) => (
        <button
          key={position}
          type="button"
          aria-pressed={position === value}
          onClick={() => { onChange(position); }}
          className={cn(
            'h-11 border-r border-border/70 text-[11px] font-bold transition-colors last:border-r-0 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            position === value
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
          )}
        >
          {position}
        </button>
      ))}
    </div>
  );
}

function SidePanelStatus({
  connection,
  sync,
}: {
  readonly connection: SidePanelConnection;
  readonly sync: DraftSyncViewState;
}): React.ReactElement {
  const config = useDraftStore((state) => state.config);
  const currentPick = useDraftStore((state) => state.currentPick);
  const picksUntilTurn = getPicksUntilMyTurn(
    currentPick,
    config.myPickPosition,
    config.totalTeams,
    config.totalRounds
  );

  return (
    <div className="grid grid-cols-[1.55fr_.75fr_1fr] items-center overflow-hidden rounded-xl border border-border/80 bg-card text-[11px] shadow-xs">
      <div className="flex h-14 min-w-0 flex-col justify-center gap-0.5 px-3">
        <span className="truncate font-semibold">{getProviderLabel(connection.provider)} draft</span>
        <DraftSyncStatusIndicator sync={sync} compact className="text-[10px]" />
      </div>
      <div className="flex h-14 items-center justify-center border-x border-border/70 px-2 font-mono text-muted-foreground">
        {formatRoundPick(currentPick, config.totalTeams)}
      </div>
      <div className="flex h-14 items-center justify-end px-3 text-right font-semibold text-emerald-700 dark:text-emerald-300">
        {picksUntilTurn === 0
          ? 'Your pick now'
          : picksUntilTurn === null
            ? 'Draft complete'
            : `Your pick in ${String(picksUntilTurn)}`}
      </div>
    </div>
  );
}

function SignalValue({
  label,
  value,
  motionKey,
}: {
  readonly label: string;
  readonly value: string;
  readonly motionKey: React.Key;
}): React.ReactElement {
  return (
    <div className="min-w-0 px-2 text-center">
      <MotionMetricSwap
        motionKey={motionKey}
        className="font-mono text-base font-bold text-emerald-700 dark:text-emerald-300"
      >
        {value}
      </MotionMetricSwap>
      <div className="mt-1 truncate text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

function RecommendationHero({
  decision,
  player,
  onCompare,
  onAskWhy,
}: {
  readonly decision: DraftDecisionView;
  readonly player?: Player;
  readonly onCompare: () => void;
  readonly onAskWhy: () => void;
}): React.ReactElement {
  const recommendation = decision.preferred ?? undefined;
  if (!recommendation) {
    return (
      <section className="rounded-xl border border-border/80 bg-card p-5 text-center">
        <h2 className="font-bold">No recommendation available</h2>
        <p className="mt-2 text-sm text-muted-foreground">Try another position or wait for the next synced pick.</p>
      </section>
    );
  }

  const diagnostics = recommendation.diagnostics;
  const survival = getSurvival(recommendation);
  const rank = decision.rankByPlayerId.get(recommendation.playerId);
  const detailedExplanation = decision.explanationByPlayerId.get(recommendation.playerId)
    ?? getRecommendationExplanation(recommendation);
  const explanation = getCompactDecisionExplanation(
    recommendation,
    detailedExplanation
  );

  return (
    <section className="rounded-xl border border-border/80 bg-card p-4 shadow-sm">
      <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        Your best pick
      </div>
      <MotionIdentitySwap motionKey={recommendation.playerId}>
        <div className="mt-3 flex items-center gap-3">
          <PlayerHeadshot
            playerId={recommendation.playerId}
            name={recommendation.playerName}
            position={recommendation.position}
            className="size-20 rounded-xl border border-border/80"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xl font-bold">{recommendation.playerName}</div>
            <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <span className={cn('font-mono font-bold', getPositionTextColor(recommendation.position))}>
                {recommendation.position}
              </span>
              {player?.team ? <span>· {player.team}</span> : null}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              #{String(rank ?? 1)} {recommendation.position} option · {getRecommendationPolicyLabel(decision.selection)}
            </div>
          </div>
        </div>
      </MotionIdentitySwap>
        <div className="mt-4 grid grid-cols-3 divide-x divide-border">
          <SignalValue
            label="VOR"
            value={diagnostics ? formatSignedNumber(diagnostics.valueOverReplacement, 0) : '—'}
            motionKey={diagnostics?.valueOverReplacement ?? 'none'}
          />
          <SignalValue
            label={diagnostics?.isLastInTier ? 'last in tier' : 'position tier'}
            value={`Tier ${String(diagnostics?.tier ?? '—')}`}
            motionKey={`${String(diagnostics?.tier)}:${String(diagnostics?.isLastInTier)}`}
          />
          <SignalValue
            label={diagnostics?.nextPickLabel ? `at pick ${diagnostics.nextPickLabel}` : 'at next pick'}
            value={survival === null ? '—' : `${String(survival)}%`}
            motionKey={`${String(survival)}:${diagnostics?.nextPickLabel ?? 'none'}`}
          />
        </div>
        <div className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-300" />
          <MotionMetricSwap motionKey={explanation}>{explanation}</MotionMetricSwap>
        </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button onClick={onCompare}>
          <GitCompareArrows className="size-4" /> Compare options
        </Button>
        <Button variant="outline" onClick={onAskWhy}>
          <Lightbulb className="size-4" /> Ask why
        </Button>
      </div>
    </section>
  );
}

function ComparisonList({
  decision,
  playerById,
  selectedIds,
  onToggle,
  onCompare,
}: {
  readonly decision: DraftDecisionView;
  readonly playerById: ReadonlyMap<string, Player>;
  readonly selectedIds: ReadonlySet<string>;
  readonly onToggle: (playerId: string) => void;
  readonly onCompare: () => void;
}): React.ReactElement {
  const recommendations = decision.recommendations;
  const nextPickLabel = recommendations[0]?.diagnostics?.nextPickLabel;
  return (
    <section className="rounded-xl border border-border/80 bg-card p-3 shadow-sm">
      <div className="px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        Compare available
      </div>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_48px_40px_62px] px-2 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
        <span>Player</span><span>VOR</span><span>Tier</span><span>{nextPickLabel ? `Pick ${nextPickLabel}` : 'Next pick'}</span>
      </div>
      <div className="mt-1.5 space-y-1.5">
        {recommendations.slice(0, 3).map((recommendation) => {
          const player = playerById.get(recommendation.playerId);
          const isSelected = selectedIds.has(recommendation.playerId);
          const diagnostics = recommendation.diagnostics;
          const survival = getSurvival(recommendation);
          const rank = decision.rankByPlayerId.get(recommendation.playerId);
          return (
            <button
              key={recommendation.playerId}
              type="button"
              aria-pressed={isSelected}
              onClick={() => { onToggle(recommendation.playerId); }}
              className={cn(
                'grid w-full grid-cols-[minmax(0,1fr)_48px_40px_62px] items-center rounded-lg border px-2 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isSelected ? 'border-emerald-500/70 bg-emerald-500/[0.06]' : 'border-border/70 hover:bg-muted/35'
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded-full border',
                  isSelected ? 'border-emerald-500' : 'border-muted-foreground'
                )}>
                  {isSelected ? <span className="size-2 rounded-full bg-emerald-500" /> : null}
                </span>
                <PlayerHeadshot
                  playerId={recommendation.playerId}
                  name={recommendation.playerName}
                  position={recommendation.position}
                  className="size-9 rounded-lg"
                />
                <span className="min-w-0">
                  <span className="block truncate text-[11px] font-bold">{recommendation.playerName}</span>
                  <span className={cn('mt-0.5 block text-[9px] font-mono', getPositionTextColor(recommendation.position))}>
                    #{String(rank ?? '—')} · {recommendation.position}{player?.team ? ` · ${player.team}` : ''}
                  </span>
                </span>
              </span>
              <span className="font-mono text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                {diagnostics ? formatSignedNumber(diagnostics.valueOverReplacement, 0) : '—'}
              </span>
              <span className="font-mono text-[11px]">T{String(diagnostics?.tier ?? '—')}</span>
              <span className="text-right font-mono text-[11px]">{survival === null ? '—' : `${String(survival)}%`}</span>
            </button>
          );
        })}
      </div>
      <Button className="mt-3 w-full" disabled={selectedIds.size !== 2} onClick={onCompare}>
        Compare {String(selectedIds.size)} players
      </Button>
    </section>
  );
}

function RosterPressure({ needs }: { readonly needs: readonly PositionNeed[] }): React.ReactElement {
  const rankedNeeds = [...needs]
    .sort((left, right) => {
      const order = { critical: 0, high: 1, medium: 2, low: 3, defer: 4, filled: 5 } as const;
      return order[left.priority] - order[right.priority];
    })
    .slice(0, 3);

  return (
    <section className="rounded-xl border border-border/80 bg-card p-3 shadow-sm">
      <div className="px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        Roster pressure
      </div>
      <div className="mt-3 grid grid-cols-3 divide-x divide-border">
        {rankedNeeds.map((need) => (
          <div key={need.position} className="px-2 text-center">
            <div className={cn('text-xs font-bold', getPositionTextColor(need.position))}>
              {need.position} {getNeedLabel(need)}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">{getNeedDescription(need)}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function HeadToHead({
  recommendations,
  decision,
  playerById,
  onAskWhy,
}: {
  readonly recommendations: readonly Recommendation[];
  readonly decision: DraftDecisionView;
  readonly playerById: ReadonlyMap<string, Player>;
  readonly onAskWhy: () => void;
}): React.ReactElement {
  const [first, second] = recommendations;
  if (!first || !second) {
    return <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Select two players to compare.</div>;
  }

  const firstDiagnostics = first.diagnostics;
  const secondDiagnostics = second.diagnostics;
  const rows = [
    ['Recommendation rank', `#${String(decision.rankByPlayerId.get(first.playerId) ?? '—')}`, `#${String(decision.rankByPlayerId.get(second.playerId) ?? '—')}`],
    ['Value over replacement', firstDiagnostics ? formatSignedNumber(firstDiagnostics.valueOverReplacement, 0) : '—', secondDiagnostics ? formatSignedNumber(secondDiagnostics.valueOverReplacement, 0) : '—'],
    ['Position tier', `Tier ${String(firstDiagnostics?.tier ?? '—')}`, `Tier ${String(secondDiagnostics?.tier ?? '—')}`],
    ['At your next pick', getSurvival(first) === null ? '—' : `${String(getSurvival(first))}%`, getSurvival(second) === null ? '—' : `${String(getSurvival(second))}%`],
    ['Overall ECR', `#${String(firstDiagnostics?.expertRank ?? '—')}`, `#${String(secondDiagnostics?.expertRank ?? '—')}`],
  ] as const;
  const firstPlayer = playerById.get(first.playerId);
  const secondPlayer = playerById.get(second.playerId);
  const preferred = getPreferredRecommendation(decision, [first, second]) ?? first;
  const preferredExplanation = decision.explanationByPlayerId.get(preferred.playerId)
    ?? getRecommendationExplanation(preferred);

  return (
    <>
      <DecisionSwap motionKey={`${first.playerId}:${second.playerId}`}>
        <section className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm">
          <div className="border-b border-border/70 px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Head-to-head
          </div>
          <div className="grid grid-cols-[1.15fr_1fr_1fr] border-b border-border/70">
            <div />
            {[{ recommendation: first, player: firstPlayer }, { recommendation: second, player: secondPlayer }].map(({ recommendation, player }) => (
              <div key={recommendation.playerId} className="min-w-0 border-l border-border/70 p-3 text-center">
                <PlayerHeadshot
                  playerId={recommendation.playerId}
                  name={recommendation.playerName}
                  position={recommendation.position}
                  className="mx-auto size-12 rounded-lg"
                />
                <div className="mt-2 truncate text-[11px] font-bold">{recommendation.playerName}</div>
                <div className="mt-0.5 text-[9px] text-muted-foreground">{recommendation.position}{player?.team ? ` · ${player.team}` : ''}</div>
              </div>
            ))}
          </div>
          {rows.map(([label, firstValue, secondValue]) => (
            <div key={label} className="grid grid-cols-[1.15fr_1fr_1fr] border-b border-border/70 text-[11px] last:border-b-0">
              <div className="px-3 py-2.5 text-muted-foreground">{label}</div>
              <div className={cn(
                'border-l border-border/70 px-2 py-2.5 text-center font-mono',
                preferred.playerId === first.playerId && 'font-bold text-emerald-700 dark:text-emerald-300'
              )}>{firstValue}</div>
              <div className={cn(
                'border-l border-border/70 px-2 py-2.5 text-center font-mono',
                preferred.playerId === second.playerId && 'font-bold text-emerald-700 dark:text-emerald-300'
              )}>{secondValue}</div>
            </div>
          ))}
        </section>
        <section className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.07] p-4">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
            <Target className="size-4" /> Edge: {preferred.playerName}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {preferredExplanation}
          </p>
          <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {getRecommendationPolicyLabel(decision.selection)} policy · rank #{String(decision.rankByPlayerId.get(preferred.playerId) ?? '—')}
          </p>
        </section>
      </DecisionSwap>
      <Button className="w-full" onClick={onAskWhy}>
        <Lightbulb className="size-4" /> Ask why
      </Button>
    </>
  );
}

function AssistantPanel({
  decision,
  comparison,
  needs,
}: {
  readonly decision: DraftDecisionView;
  readonly comparison?: Recommendation;
  readonly needs: readonly PositionNeed[];
}): React.ReactElement {
  const [lens, setLens] = React.useState<AssistantLens>('why');
  const recommendation = decision.preferred ?? undefined;
  if (!recommendation) {
    return <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">No player is available to analyze.</div>;
  }

  const diagnostics = recommendation.diagnostics;
  const survival = getSurvival(recommendation);
  const expectedAlternative = recommendation.decisionFactors?.draftTiming.expectedAlternative
    ?? diagnostics?.expectedNextPickAlternative;
  const need = needs.find((item) => item.position === recommendation.position);
  const detailedExplanation = decision.explanationByPlayerId.get(recommendation.playerId)
    ?? getRecommendationExplanation(recommendation);
  const explanation = getCompactDecisionExplanation(
    recommendation,
    detailedExplanation
  );
  const reasons = [
    diagnostics ? `${formatSignedNumber(diagnostics.valueOverReplacement, 0)} points above replacement` : recommendation.reason,
    diagnostics?.isLastInTier
      ? `Last remaining player in ${recommendation.position} Tier ${String(diagnostics.tier)}`
      : `${String(diagnostics?.tierRemaining ?? 'Several')} players remain in Tier ${String(diagnostics?.tier ?? '—')}`,
    survival === null ? 'Availability is still calculating' : `Waiting risks a ${String(100 - survival)}% miss chance`,
  ];

  return (
    <>
      <DecisionSwap motionKey={recommendation.playerId}>
        <section className="rounded-xl border border-border/80 bg-card p-4 shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-300">
            Assistant answer
          </div>
          <h2 className="mt-2 text-xl font-bold leading-tight">
            {survival !== null && survival < 50 ? `Take ${recommendation.playerName} if available.` : `${recommendation.playerName} is the best current option.`}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {explanation}
          </p>
        </section>
      </DecisionSwap>
      <div className="grid grid-cols-4 overflow-hidden rounded-xl border border-border/80 bg-card">
        {([
          ['why', 'Why'],
          ['compare', 'Compare'],
          ['wait', 'Can I wait?'],
          ['roster', 'Roster need'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={lens === id}
            onClick={() => { setLens(id); }}
            className={cn(
              'min-h-12 border-r border-border/70 px-1 text-[10px] font-semibold last:border-r-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              lens === id ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground hover:bg-muted/40'
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <section className="rounded-xl border border-border/80 bg-card p-4 shadow-sm">
        <DecisionSwap motionKey={`${lens}:${recommendation.playerId}:${comparison?.playerId ?? 'none'}`}>
          {lens === 'why' ? (
            <div>
              <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-300">Why this player?</h3>
              <div className="mt-3 space-y-3">
                {reasons.map((reason) => (
                  <div key={reason} className="flex gap-2 border-b border-border/60 pb-3 text-sm last:border-b-0 last:pb-0">
                    <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-300" />
                    <span>{reason}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : lens === 'compare' ? (
            <div>
              <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-300">Quick comparison</h3>
              {comparison ? (
                <div className="mt-3 overflow-hidden rounded-lg border border-border/70 text-xs">
                  <div className="grid grid-cols-3 bg-muted/30 px-3 py-2 font-bold"><span>Signal</span><span>{recommendation.playerName}</span><span>{comparison.playerName}</span></div>
                  <div className="grid grid-cols-3 border-t px-3 py-2"><span className="text-muted-foreground">VOR</span><span className="font-mono text-emerald-700 dark:text-emerald-300">{diagnostics ? formatSignedNumber(diagnostics.valueOverReplacement, 0) : '—'}</span><span className="font-mono">{comparison.diagnostics ? formatSignedNumber(comparison.diagnostics.valueOverReplacement, 0) : '—'}</span></div>
                  <div className="grid grid-cols-3 border-t px-3 py-2"><span className="text-muted-foreground">Tier</span><span className="font-mono">{String(diagnostics?.tier ?? '—')}</span><span className="font-mono">{String(comparison.diagnostics?.tier ?? '—')}</span></div>
                </div>
              ) : <p className="mt-3 text-sm text-muted-foreground">Select a second player in Compare.</p>}
            </div>
          ) : lens === 'wait' ? (
            <div>
              <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-300">Can I wait?</h3>
              <p className="mt-3 text-lg font-bold">{survival === null ? 'Still calculating' : `${String(survival)}% at pick ${diagnostics?.nextPickLabel ?? 'next'}`}</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {survival !== null && survival < 35 ? 'Waiting is high risk.' : 'The board carries meaningful uncertainty.'}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {expectedAlternative
                  ? `${expectedAlternative.playerName} is the expected ${recommendation.position} fallback at ${formatSignedNumber(expectedAlternative.expectedValue, 0)} expected points above replacement.`
                  : `No same-position fallback is projected for that selection.`}
              </p>
              {diagnostics?.survivalModelSource === 'league-history' ? (
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  Timing evidence: 70% Primary League history, 25% current consensus, 5% Sleeper search rank.
                </p>
              ) : null}
            </div>
          ) : (
            <div>
              <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-300">Roster need</h3>
              <p className="mt-3 text-lg font-bold">{recommendation.position} is {need ? getNeedLabel(need).toLowerCase() : 'an open need'}.</p>
              <p className="mt-2 text-sm text-muted-foreground">{need ? `${getNeedSlotSummary(need)}.` : 'Roster context is unavailable.'}</p>
            </div>
          )}
        </DecisionSwap>
      </section>
    </>
  );
}

function RosterPanel({
  playerById,
  needs,
}: {
  readonly playerById: ReadonlyMap<string, Player>;
  readonly needs: readonly PositionNeed[];
}): React.ReactElement {
  const roster = useDraftStore((state) => state.myRoster);
  const config = useDraftStore((state) => state.config);

  return (
    <>
      <section className="rounded-xl border border-border/80 bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-bold">My roster</h2>
            <p className="mt-1 text-xs text-muted-foreground">Draft slot {String(config.myPickPosition)}</p>
          </div>
          <Shirt className="size-5 text-emerald-600 dark:text-emerald-300" />
        </div>
        <div className="mt-4 space-y-2">
          {POSITIONS.map((position) => {
            const playerIds = roster[position];
            return (
              <div key={position} className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-border/70 px-3 py-2.5">
                <span className={cn('font-mono text-xs font-bold', getPositionTextColor(position))}>{position}</span>
                <span className="min-w-0 text-xs text-muted-foreground">
                  {playerIds.length === 0
                    ? 'Open'
                    : playerIds.map((playerId) => playerById.get(playerId)?.name ?? 'Unknown').join(', ')}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">{String(playerIds.length)} / {String(config.rosterRequirements[position].max)}</span>
              </div>
            );
          })}
        </div>
      </section>
      <RosterPressure needs={needs} />
    </>
  );
}

function BottomNavigation({
  view,
  onChange,
}: {
  readonly view: SidePanelView;
  readonly onChange: (view: SidePanelView) => void;
}): React.ReactElement {
  const items: readonly { readonly id: SidePanelView; readonly label: string; readonly icon: typeof ShieldCheck }[] = [
    { id: 'draft', label: 'Draft', icon: ShieldCheck },
    { id: 'compare', label: 'Compare', icon: Scale },
    { id: 'assistant', label: 'Assistant', icon: Bot },
    { id: 'roster', label: 'Roster', icon: Shirt },
  ];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto grid h-[72px] max-w-[520px] grid-cols-4 border-t border-border/80 bg-background/95 px-2 backdrop-blur" aria-label="Side panel navigation">
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.id === view;
        return (
          <button
            key={item.id}
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={() => { onChange(item.id); }}
            className={cn(
              'flex flex-col items-center justify-center gap-1 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              active ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className="size-5" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export function SidePanelPage(): React.ReactElement {
  const [connection] = React.useState(readConnection);
  const [view, setView] = React.useState<SidePanelView>('draft');
  const [positionFilter, setPositionFilter] = React.useState<PositionFilter>('ALL');
  const [selectedPlayerIds, setSelectedPlayerIds] = React.useState<readonly string[]>([]);
  const sync = useSidePanelSync(connection);
  const decision = useDraftDecision();
  const { players, isLoading, isError } = usePlayerDataQuery();
  const { needs } = useTeamNeeds();
  const leagueSettings = useDraftStore((state) => state.leagueSettings);
  const totalTeams = useDraftStore((state) => state.config.totalTeams);
  const playerById = React.useMemo(
    () => new Map(players.map((player) => [player.id, player])),
    [players]
  );
  const activeDecision = positionFilter === 'ALL'
    ? decision.overall
    : decision.byPosition[positionFilter];
  const recommendations = positionFilter === 'ALL'
    ? activeDecision.recommendations
    : getPositionRecommendations(activeDecision);
  const topRecommendation = activeDecision.preferred ?? undefined;
  const showReadinessBlock =
    view !== 'roster' &&
    decision.recommendationsBlocked &&
    !decision.recommendationsBlockedByProviderIdentity &&
    decision.readiness !== null;
  const showProviderIdentityBlock =
    view !== 'roster' && decision.recommendationsBlockedByProviderIdentity;
  const showRecommendationBlock =
    showReadinessBlock || showProviderIdentityBlock;
  const recommendationSelectionKey = [
    recommendations[0]?.playerId ?? '',
    recommendations[1]?.playerId ?? '',
  ].join('\0');

  React.useEffect(() => {
    setSelectedPlayerIds(
      recommendationSelectionKey.split('\0').filter((playerId) => playerId.length > 0)
    );
  }, [recommendationSelectionKey]);

  React.useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [view]);

  const selectedRecommendations = selectedPlayerIds.flatMap((playerId) => {
    const recommendation = recommendations.find((item) => item.playerId === playerId);
    return recommendation ? [recommendation] : [];
  });
  const comparisonRecommendation = selectedRecommendations.find(
    (recommendation) => recommendation.playerId !== topRecommendation?.playerId
  ) ?? recommendations.find((recommendation) => recommendation.playerId !== topRecommendation?.playerId);

  const toggleSelectedPlayer = React.useCallback((playerId: string): void => {
    setSelectedPlayerIds((current) => {
      if (current.includes(playerId)) return current.filter((id) => id !== playerId);
      if (current.length >= 2) return [current[1] ?? playerId, playerId];
      return [...current, playerId];
    });
  }, []);

  const openFullDraftRoom = React.useCallback((): void => {
    const params = new URLSearchParams(window.location.search);
    const target = `/draft${params.size > 0 ? `?${params.toString()}` : ''}`;
    window.open(target, '_blank', 'noopener,noreferrer');
  }, []);

  if (isLoading || decision.isLoading) {
    return <RouteSkeleton route="sidepanel" />;
  }

  if (isError) {
    return <main className="flex min-h-dvh items-center justify-center bg-background px-6 text-center text-sm text-destructive">Unable to load player data.</main>;
  }

  return (
    <div className="mx-auto min-h-dvh max-w-[520px] bg-background pb-24 text-foreground">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border/70 bg-background/95 px-4 backdrop-blur">
        <div className="flex min-w-0 items-center gap-2.5">
          {view === 'draft' ? (
            <ShieldCheck className="size-7 shrink-0 text-emerald-600 dark:text-emerald-300" />
          ) : (
            <button
              type="button"
              aria-label="Return to Draft"
              onClick={() => { setView('draft'); }}
              className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronLeft className="size-5" />
            </button>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-base font-bold">
              {view === 'draft' ? 'Fantasy Draft' : view === 'compare' ? 'Compare players' : view === 'assistant' ? 'Assistant' : 'My roster'}
            </h1>
            {view === 'draft' && leagueSettings.source === 'espn' ? (
              <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                {String(leagueSettings.totalTeams)}-team PPR · {leagueSettings.keepersEnabled ? 'keepers' : 'no keepers'}
              </div>
            ) : view !== 'draft' ? (
              <div className="mt-0.5 flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-300">
                <Radio className="size-2.5" /> Live decision state
              </div>
            ) : null}
          </div>
        </div>
        <ThemeMenu compact />
      </header>

      <main className="space-y-3 p-3">
        <SidePanelStatus connection={connection} sync={sync} />
        {(view === 'draft' || view === 'compare') && !showRecommendationBlock ? (
          <PositionFilters
            value={positionFilter}
            onChange={(position) => {
              setPositionFilter(position);
              setView(view === 'compare' ? 'compare' : 'draft');
            }}
          />
        ) : null}

        <DecisionSwap
          motionKey={showProviderIdentityBlock
            ? 'provider-identity-blocked'
            : showReadinessBlock
              ? 'readiness-blocked'
              : view}
          axis="x"
          distance={12}
          className="space-y-3"
        >
          {showProviderIdentityBlock ? (
            <ProviderIdentityBlockedNotice
              unresolvedPicks={decision.unresolvedProviderPicks}
              totalTeams={totalTeams}
            />
          ) : showReadinessBlock && decision.readiness ? (
            <DraftReadinessBlockedNotice readiness={decision.readiness} />
          ) : view === 'draft' ? (
            <>
              <RecommendationHero
                decision={activeDecision}
                player={topRecommendation ? playerById.get(topRecommendation.playerId) : undefined}
                onCompare={() => { setView('compare'); }}
                onAskWhy={() => { setView('assistant'); }}
              />
              <ComparisonList
                decision={activeDecision}
                playerById={playerById}
                selectedIds={new Set(selectedPlayerIds)}
                onToggle={toggleSelectedPlayer}
                onCompare={() => { setView('compare'); }}
              />
              <RosterPressure needs={needs} />
              <Button variant="outline" className="w-full" onClick={openFullDraftRoom}>
                Open full draft room <ExternalLink className="size-4" />
              </Button>
            </>
          ) : view === 'compare' ? (
            <>
              <HeadToHead
                recommendations={selectedRecommendations}
                decision={activeDecision}
                playerById={playerById}
                onAskWhy={() => { setView('assistant'); }}
              />
              <div className="rounded-xl border border-border/80 bg-card p-3 shadow-sm">
                <div className="px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                  Top {positionFilter === 'ALL' ? 'available' : positionFilter} options
                </div>
                <ComparisonList
                  decision={activeDecision}
                  playerById={playerById}
                  selectedIds={new Set(selectedPlayerIds)}
                  onToggle={toggleSelectedPlayer}
                  onCompare={() => undefined}
                />
              </div>
              <Button variant="outline" className="w-full" onClick={() => { setView('draft'); }}>
                <ChevronLeft className="size-4" /> Return to Draft
              </Button>
            </>
          ) : view === 'assistant' ? (
            <AssistantPanel
              decision={activeDecision}
              comparison={comparisonRecommendation}
              needs={needs}
            />
          ) : (
            <RosterPanel playerById={playerById} needs={needs} />
          )}
        </DecisionSwap>
      </main>

      <BottomNavigation view={view} onChange={setView} />
    </div>
  );
}
