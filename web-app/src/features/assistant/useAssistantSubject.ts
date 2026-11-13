import * as React from 'react';
import type { Player, Position } from '@fantasy-draft/shared/league';
import { orderAnalysedRecommendations, type DecisionLens, type DraftDecisionOutput, type DraftDecisionView, type Recommendation } from '@fantasy-draft/shared/draft';
import type { NextPickAvailability } from '@/lib/next-pick-availability';
import { modelDepth } from './assistant-pool';
import { isMissingSelection, resolveViewedPlayer, type AssistantLens, type ViewedPlayer } from './assistant-navigation';
import { toAnalysisTab, type AnalysisTab } from './AssistantLayout';

/** Where the other decision lens picks a different leader. Shown only while that leader is the subject. */
export interface LensDivergence {
  readonly label: 'Best Pick' | 'Best Player';
  readonly playerId: string;
  readonly playerName: string;
  readonly position: Position;
  readonly reason: string | null;
}

/**
 * Everything the analysis panel says about its one subject, gathered in one place so a card, tier row, search result
 * or list row only ever changes which player this describes.
 */
export interface AnalysisSubject {
  readonly viewed: ViewedPlayer;
  /** The requested player is no longer in the catalog, so this shows the leader instead (and says so). */
  readonly missingSelection: boolean;
  /** The catalog player, also for a subject the model does not analyse (so it stays draftable and queueable). */
  readonly player: Player | undefined;
  /** Overall rank for this pick, when the player is in the overall order. */
  readonly rank: number | undefined;
  /** Length of the overall order, for "not in the top N". */
  readonly modelDepth: number;
  readonly isLeader: boolean;
  readonly isTopPick: boolean;
  readonly alerts: readonly string[];
  readonly divergence: LensDivergence | null;
  readonly sameByeName: string | null;
  /** The survival model's figure for a subject without analysis; the analysis's own figure otherwise. */
  readonly availability: NextPickAvailability;
  readonly isQueued: boolean;
  /** Opened from a card's "Full reasoning": a new count for each request (0 for none), so every request re-opens it. */
  readonly expandReasoning: number;
  /** The pair shown in Compare, and every player either slot may be swapped to. */
  readonly comparison: { readonly pair: readonly Recommendation[]; readonly candidates: readonly Recommendation[] };
}

/** The subject plus the controls that change it. */
export interface AssistantSubjectState {
  readonly subject: AnalysisSubject;
  readonly viewedPlayerId: string | undefined;
  readonly viewedPosition: Position | null;
  readonly tab: AnalysisTab;
  readonly setTab: (tab: AnalysisTab) => void;
  readonly select: (playerId: string) => void;
  /** `expand` opens the full reasoning; `reveal: false` keeps the page where it is (the analysis is already beside the card). */
  readonly explain: (playerId: string, options?: { readonly expand?: boolean; readonly reveal?: boolean }) => void;
  /** Back to the leader, e.g. after a lens change. */
  readonly reset: () => void;
  readonly setComparisonPlayerId: (playerId: string) => void;
  readonly highlightedPlayerIds: ReadonlySet<string>;
  readonly selectionLabel: 'Viewing' | 'Comparing';
  readonly analysisRef: React.RefObject<HTMLElement>;
}

const UNESTIMATED: NextPickAvailability = { kind: 'unestimated' };
const NO_NEXT_PICK: NextPickAvailability = { kind: 'no-next-pick' };

/**
 * The Assistant's analysis subject: which player is selected, which tab is open, the comparison partner, and the
 * players highlighted in the lists. Compare draws its second player from the same coverage as the first (every
 * player the model analyses), so anyone found by search or a position list can be compared.
 */
export function useAssistantSubject({
  initialSelectedPlayerId,
  initialLens,
  overall,
  output,
  lens,
  recommendationById,
  playerById,
  draftedPlayerIds,
  alertsById,
  rosteredPlayers,
  queuedSet,
  availabilityById,
  finalPick,
}: {
  readonly initialSelectedPlayerId: string | null;
  readonly initialLens: AssistantLens;
  readonly overall: DraftDecisionView;
  readonly output: Pick<DraftDecisionOutput, 'bestPick' | 'bestPlayer' | 'decisionDivergenceExplanation'>;
  readonly lens: DecisionLens;
  readonly recommendationById: ReadonlyMap<string, Recommendation>;
  readonly playerById: ReadonlyMap<string, Player>;
  readonly draftedPlayerIds: ReadonlySet<string>;
  readonly alertsById: ReadonlyMap<string, readonly string[]>;
  readonly rosteredPlayers: readonly Player[];
  readonly queuedSet: ReadonlySet<string>;
  readonly availabilityById: ReadonlyMap<string, NextPickAvailability>;
  readonly finalPick: boolean;
}): AssistantSubjectState {
  const [selectedPlayerId, setSelectedPlayerId] = React.useState<string | null>(initialSelectedPlayerId);
  const [comparisonPlayerId, setComparisonPlayerId] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<AnalysisTab>(toAnalysisTab(initialLens));
  const [focusRequest, setFocusRequest] = React.useState({ count: 0, reveal: true });
  const [expandRequest, setExpandRequest] = React.useState<{ readonly playerId: string | null; readonly count: number }>({ playerId: null, count: 0 });
  const analysisRef = React.useRef<HTMLElement>(null);

  const select = React.useCallback((playerId: string): void => {
    setSelectedPlayerId(playerId);
    setComparisonPlayerId(null);
    setExpandRequest((current) => ({ playerId: null, count: current.count }));
  }, []);
  /** Select, open Why this player? and move focus into the analysis (a card's Full reasoning, a tier row). */
  const explain = React.useCallback((playerId: string, { expand = false, reveal = true }: { readonly expand?: boolean; readonly reveal?: boolean } = {}): void => {
    select(playerId);
    setTab('why');
    if (expand) setExpandRequest((current) => ({ playerId, count: current.count + 1 }));
    setFocusRequest((current) => ({ count: current.count + 1, reveal }));
  }, [select]);
  const reset = React.useCallback((): void => {
    setSelectedPlayerId(null);
    setComparisonPlayerId(null);
    setExpandRequest((current) => ({ playerId: null, count: current.count }));
  }, []);
  React.useEffect(() => {
    if (focusRequest.count === 0) return;
    analysisRef.current?.focus({ preventScroll: true });
    if (focusRequest.reveal) analysisRef.current?.scrollIntoView({ block: 'nearest' });
  }, [focusRequest]);

  const leader = overall.preferred;
  const viewed = resolveViewedPlayer({ selectedPlayerId, recommendationById, playerById, draftedPlayerIds, leader });
  const recommendation = viewed.kind === 'recommendation' ? viewed.recommendation : undefined;
  const viewedPlayerId = recommendation?.playerId ?? (viewed.kind === 'unavailable' ? viewed.playerId : undefined);

  // Every analysed player, overall order first, then the rest by score: the coverage both Compare slots share.
  const orderedRecommendations = React.useMemo(
    () => orderAnalysedRecommendations(overall.recommendations, recommendationById.values()),
    [overall.recommendations, recommendationById]
  );
  const candidates = React.useMemo(
    () => recommendation ? orderedRecommendations.filter((item) => item.playerId !== recommendation.playerId) : [],
    [orderedRecommendations, recommendation]
  );
  const partner = candidates.find((item) => item.playerId === comparisonPlayerId)
    ?? (recommendation?.playerId === leader?.playerId ? candidates[0] : leader ?? undefined);
  const pair = React.useMemo(
    (): readonly Recommendation[] => recommendation && partner ? [recommendation, partner] : recommendation ? [recommendation] : [],
    [partner, recommendation]
  );

  // Compare highlights its pair only when there is one to show. A subject without analysis (an unranked search
  // result) has no comparison, so it stays the viewed row with its Viewing label instead of losing the highlight.
  const isComparing = tab === 'compare' && pair.length > 1;
  const highlightKey = isComparing ? pair.map((item) => item.playerId).join('\u0000') : viewedPlayerId ?? '';
  const highlightedPlayerIds = React.useMemo(
    (): ReadonlySet<string> => new Set(highlightKey ? highlightKey.split('\u0000') : []),
    [highlightKey]
  );

  const player = viewedPlayerId ? playerById.get(viewedPlayerId) : undefined;
  const otherLeader = lens === 'best-pick' ? output.bestPlayer : output.bestPick;
  const divergence: LensDivergence | null = leader && otherLeader && otherLeader.playerId !== leader.playerId
    ? {
        label: lens === 'best-pick' ? 'Best Player' : 'Best Pick',
        playerId: otherLeader.playerId,
        playerName: otherLeader.playerName,
        position: otherLeader.position,
        reason: output.decisionDivergenceExplanation,
      }
    : null;
  const sameByeName = recommendation && player
    ? rosteredPlayers.find((rostered) => rostered.id !== player.id && rostered.position === player.position && rostered.byeWeek === player.byeWeek)?.name ?? null
    : null;
  const subject: AnalysisSubject = {
    viewed,
    missingSelection: isMissingSelection({ selectedPlayerId, recommendationById, playerById }),
    player: viewed.kind === 'unavailable' && viewed.reason === 'drafted' ? undefined : player,
    rank: viewedPlayerId ? overall.rankByPlayerId.get(viewedPlayerId) : undefined,
    modelDepth: modelDepth(overall),
    isLeader: viewedPlayerId !== undefined && viewedPlayerId === leader?.playerId,
    isTopPick: recommendation !== undefined && recommendation.playerId === output.bestPick?.playerId,
    alerts: viewedPlayerId ? alertsById.get(viewedPlayerId) ?? [] : [],
    divergence,
    sameByeName,
    availability: finalPick ? NO_NEXT_PICK : viewedPlayerId ? availabilityById.get(viewedPlayerId) ?? UNESTIMATED : UNESTIMATED,
    isQueued: viewedPlayerId !== undefined && queuedSet.has(viewedPlayerId),
    expandReasoning: expandRequest.playerId !== null && expandRequest.playerId === viewedPlayerId ? expandRequest.count : 0,
    comparison: { pair, candidates },
  };

  return {
    subject,
    viewedPlayerId,
    viewedPosition: recommendation?.position ?? (viewed.kind === 'unavailable' ? viewed.position : null),
    tab,
    setTab,
    select,
    explain,
    reset,
    setComparisonPlayerId,
    highlightedPlayerIds,
    selectionLabel: isComparing ? 'Comparing' : 'Viewing',
    analysisRef,
  };
}
