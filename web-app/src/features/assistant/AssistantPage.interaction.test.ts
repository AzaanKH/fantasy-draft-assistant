// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DraftProvider, Player, Position, PositionNeed, Recommendation } from '@fantasy-draft/shared';
import { POSITIONS } from '@fantasy-draft/shared';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { DraftDecisionView } from '@/features/recommendations/draft-decision';
import type { DraftSynchronizationState } from '@/lib/draft-sync-state';
import { useDraftStore } from '@/stores/draftStore';
import { VISUAL_PLAYERS } from '@/visual/VisualApp';

import { AssistantPage } from './AssistantPage';

const RECOMMENDATION_LIMIT = 60;

function player(index: number): Player {
  const base = VISUAL_PLAYERS[0];
  if (!base) throw new Error('Missing player fixture');
  return { ...base, id: `wr-${String(index)}`, name: `Receiver ${String(index)}`, position: 'WR', tier: 1 + Math.floor(index / 10), ecrRank: index, byeWeek: 5 };
}

function recommendation(source: Player, rank: number): Recommendation {
  return {
    playerId: source.id,
    playerName: source.name,
    position: source.position,
    reason: 'Next-pick timing',
    score: 100 - rank,
    diagnostics: {
      expertRank: source.ecrRank,
      marketRank: source.ecrRank,
      marketDelta: 0,
      projectedPoints: 250 - rank,
      valueOverReplacement: 60 - rank,
      tier: source.tier,
      tierRemaining: 3,
      nextPickSurvivalProbability: 0.4,
      nextPickNumber: 24,
      nextPickLabel: '2.12',
    },
  };
}

function view(recommendations: readonly Recommendation[]): DraftDecisionView {
  return {
    recommendations,
    preferred: recommendations[0] ?? null,
    rankByPlayerId: new Map(recommendations.map((item, index) => [item.playerId, index + 1])),
    explanationByPlayerId: new Map(),
    selection: {} as DraftDecisionView['selection'],
  };
}

const players = Array.from({ length: 100 }, (_, index) => player(index + 1));
// The engine ranks at most 60 players per position, so WR #61 onwards has no recommendation.
const wrRecommendations = players.slice(0, RECOMMENDATION_LIMIT).map((item, index) => recommendation(item, index + 1));
const overall = view(wrRecommendations.slice(0, 8));
const byPosition = Object.fromEntries(POSITIONS.map((position) => [position, view(position === 'WR' ? wrRecommendations : [])])) as Record<Position, DraftDecisionView>;
const needs: PositionNeed[] = [{
  position: 'WR', priority: 'medium', startersNeeded: 2, startersFilled: 2, flexSlotsNeeded: 2, flexSlotsFilled: 0, isFlexEligible: true, scarcityScore: 5,
}];

const mocks = vi.hoisted(() => ({
  provider: 'sleeper' as DraftProvider | null,
  synchronizationState: 'confirmed' as DraftSynchronizationState,
  canDraft: true,
  draftPlayer: vi.fn(),
  togglePlayerQueued: vi.fn(),
}));

// Render swapped answers immediately instead of waiting for exit animations.
vi.mock('@/components/motion', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/components/motion')>(),
  DecisionSwap: ({ children }: { readonly children: ReactNode }) => children,
}));
vi.mock('@/features/recommendations/DraftDecisionContext', () => ({
  useDraftDecision: () => ({
    isLoading: false,
    recommendationsBlocked: false,
    recommendationsBlockedByProviderIdentity: false,
    unresolvedProviderPicks: [],
    readiness: null,
    overall,
    byPosition,
    output: { bestPick: overall.preferred, bestPlayer: overall.preferred, decisionDivergenceExplanation: null },
    setSelectedLens: vi.fn(),
  }),
}));
vi.mock('@/features/draft-room/LiveDraftSyncProvider', () => ({
  useLiveDraftSync: () => ({
    connection: mocks.provider ? { provider: mocks.provider } : null,
    synchronizationState: mocks.synchronizationState,
    lastConfirmedPickNumber: 0,
    viewState: { lastSyncAgeMs: 1000 },
  }),
}));
vi.mock('@/hooks/usePlayerData', () => ({ usePlayerDataQuery: () => ({ players }) }));
vi.mock('@/hooks/useTeamNeeds', () => ({ useTeamNeeds: () => ({ needs }) }));
vi.mock('@/hooks/useDraftPlayerAction', () => ({
  useDraftPlayerAction: () => ({ canDraft: mocks.canDraft, isMyTurn: true, draftPlayer: mocks.draftPlayer }),
}));
vi.mock('@/hooks/useQueueActions', () => ({
  useQueueActions: () => ({ togglePlayerQueued: mocks.togglePlayerQueued, removePlayerFromQueue: vi.fn() }),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 0; });
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
  Element.prototype.scrollIntoView = vi.fn();
  mocks.provider = 'sleeper';
  mocks.synchronizationState = 'confirmed';
  mocks.draftPlayer.mockClear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
});

function renderPage(sessionMode: 'live' | 'mock'): void {
  act(() => { useDraftStore.setState({ sessionMode }); });
  act(() => {
    root.render(createElement(TooltipProvider, null, createElement(AssistantPage, { onReturnToDraft: vi.fn() })));
  });
}

function button(name: string | RegExp): HTMLButtonElement {
  const match = [...document.querySelectorAll('button')].find((candidate) =>
    typeof name === 'string' ? candidate.textContent?.trim() === name : name.test(candidate.textContent ?? ''));
  if (!match) throw new Error(`No button named ${String(name)}`);
  return match;
}

function click(element: HTMLElement): void {
  act(() => { element.click(); });
}

function type(input: HTMLInputElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function analysisPanel(): HTMLElement {
  const panel = document.querySelector<HTMLElement>('section[aria-label="Viewed player analysis"]');
  if (!panel) throw new Error('Analysis panel is not rendered');
  return panel;
}

describe('Assistant tier navigation', () => {
  it('keeps a tier player outside the recommendation limit as the viewed player and focuses the analysis', () => {
    renderPage('live');
    click(button('Position tiers'));
    const search = container.querySelector<HTMLInputElement>('#rec-view-panel-tiers input');
    if (!search) throw new Error('Tier search is not rendered');
    type(search, 'Receiver 100');
    click(button(/^Receiver 100/));

    const panel = analysisPanel();
    expect(panel.textContent).toContain('Viewing: Receiver 100');
    expect(panel.textContent).toContain('Analysis unavailable. Receiver 100 is outside the WRs ranked for this draft state.');
    expect(panel.textContent).not.toContain('Receiver 1 ');
    expect(document.activeElement).toBe(panel);
  });

  it('shows the analysis of a ranked tier player', () => {
    renderPage('live');
    click(button('Position tiers'));
    click(button(/^Receiver 3/));
    expect(analysisPanel().textContent).toContain('Viewing: Receiver 3');
    expect(analysisPanel().textContent).not.toContain('Analysis unavailable');
  });
});

describe('Assistant main action by draft mode', () => {
  it('names the connected provider in Companion guidance and shows the Sleeper autopick note only for Sleeper', () => {
    renderPage('live');
    expect(container.textContent).toContain('Make the pick in Sleeper.');
    expect(container.textContent).toContain('Sleeper autopick uses your Sleeper queue.');
    expect(button('Add to queue')).toBeTruthy();

    mocks.provider = 'espn';
    renderPage('live');
    expect(container.textContent).toContain('Make the pick in ESPN.');
    expect(container.textContent).not.toContain('autopick');
  });

  it('drafts the leader in Quick Mock', () => {
    renderPage('mock');
    click(button('Draft 1'));
    expect(mocks.draftPlayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'wr-1' }));
  });

  it('opens the Provisional Pick dialog with the leader preselected in Manual Continuity', () => {
    mocks.synchronizationState = 'manual-continuity';
    renderPage('live');
    click(button('Record pick'));
    expect(document.body.textContent).toContain('Record a Provisional Pick');
    const observed = document.querySelector<HTMLSelectElement>('select[aria-label="Observed player"]');
    expect(observed?.value).toBe('wr-1');
    expect(document.body.textContent).toContain('Record the selection you saw in Sleeper.');
  });
});

describe('What does my roster need? from the page', () => {
  it('reports an open FLEX starter instead of depth when fixed WR starters are filled', () => {
    renderPage('live');
    click(button('What does my roster need?'));
    expect(analysisPanel().textContent).toContain('Fills an open FLEX starter slot.');
    expect(analysisPanel().textContent).not.toContain('This adds depth');
  });
});
