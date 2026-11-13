import { asProbability, asRank, asVor } from '@fantasy-draft/shared/units';
import { WorkspaceTestProvider } from '@/workspace/workspace-test-helpers';
// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type Player,
  type Position,
  POSITIONS,
} from '@fantasy-draft/shared/league';
import {
  type PositionNeed,
  type Recommendation,
} from '@fantasy-draft/shared/draft';
import {
  type DraftProvider,
} from '@fantasy-draft/shared/sync';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { DraftDecisionView } from '@fantasy-draft/shared/draft';
import type { DraftSynchronizationState } from '@/lib/draft-sync-state';
import { createDraftStore } from '@/stores/draftStore';
const draftStore = createDraftStore();
import { VISUAL_PLAYERS } from '@/visual/VisualApp';
import { AssistantPage } from './AssistantPage';
import { SuggestionHotkeys } from '@/features/draft-room/useSuggestionHotkeys';
import { SuggestionActionsProvider } from '@/features/draft-room/SuggestionActionsContext';

const RECOMMENDATION_LIMIT = 60;

function player(index: number): Player {
  const base = VISUAL_PLAYERS[0];
  if (!base) throw new Error('Missing player fixture');
  return { ...base, id: `wr-${String(index)}`, name: `Receiver ${String(index)}`, position: 'WR', tier: 1 + Math.floor(index / 10), ecrRank: asRank(index), byeWeek: 5 };
}

function recommendation(source: Player, rank: number): Recommendation {
  return {
    playerId: source.id,
    playerName: source.name,
    position: source.position,
    reason: 'Next-pick timing',
    score: 100 - rank,
    diagnostics: {
      expertRank: asRank(source.ecrRank),
      marketRank: source.ecrRank,
      marketDelta: 0,
      projectedPoints: 250 - rank,
      valueOverReplacement: asVor(60 - rank),
      tier: source.tier,
      tierRemaining: 3,
      nextPickSurvivalProbability: asProbability(0.4),
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
// The survival model's figure for every available player, the ranked ones and the 40 deeper WRs alike.
const nextPickAvailabilityById = new Map(players.map((item) => [item.id, { kind: 'estimate' as const, probability: asProbability(0.9), pickLabel: '2.12' }]));
const needs: PositionNeed[] = [{
  position: 'WR', priority: 'medium', startersNeeded: 2, startersFilled: 2, flexSlotsNeeded: 2, flexSlotsFilled: 0, isFlexEligible: true, scarcityScore: 5,
}];

const mocks = vi.hoisted(() => ({
  provider: 'sleeper' as DraftProvider | null,
  synchronizationState: 'confirmed' as DraftSynchronizationState,
  canDraft: true,
  pickInFlight: false,
  draftPlayer: vi.fn(),
  togglePlayerQueued: vi.fn(),
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
    nextPickAvailabilityById,
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
  useDraftPlayerAction: () => ({ canDraft: mocks.canDraft, canDraftPlayer: () => mocks.canDraft, isMyTurn: true, draftPlayer: mocks.draftPlayer, pickInFlight: mocks.pickInFlight }),
}));
vi.mock('@/hooks/useQueueActions', () => ({
  useQueueActions: () => ({ togglePlayerQueued: mocks.togglePlayerQueued, removePlayerFromQueue: vi.fn() }),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 0; });
  // Flagged tier rows open a tooltip on focus; Radix measures it with ResizeObserver, which jsdom lacks.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
  Element.prototype.scrollIntoView = vi.fn();
  mocks.provider = 'sleeper';
  mocks.synchronizationState = 'confirmed';
  mocks.draftPlayer.mockClear();
  mocks.pickInFlight = false;
  draftStore.getState().setConfig({ myPickPosition: 1 });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderPage(sessionMode: 'live' | 'mock', pageProps: { readonly initialSelectedPlayerId?: string | null } = {}): void {
  act(() => { draftStore.setState({ sessionMode }); });
  act(() => {
    // As App mounts them: the shared suggestion actions around the page and the page-wide 1-4 keys.
    root.render(createElement(WorkspaceTestProvider, { store: draftStore, children: createElement(TooltipProvider, null, createElement(SuggestionActionsProvider, null, createElement(AssistantPage, { onReturnToDraft: vi.fn(), ...pageProps }), createElement(SuggestionHotkeys))) }));
  });
}

function button(name: string | RegExp): HTMLButtonElement {
  const match = [...document.querySelectorAll('button')].find((candidate) =>
    typeof name === 'string' ? candidate.textContent.trim() === name : name.test(candidate.textContent));
  if (!match) throw new Error(`No button named ${String(name)}`);
  return match;
}

function labelled(label: string): HTMLButtonElement {
  const match = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!match) throw new Error(`No button labelled ${label}`);
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

/** Expands the best-available list past its collapsed count, when it has more. */
function showAllPlayers(): void {
  const more = [...document.querySelectorAll('.rec-pool-more button')].find((candidate) => /Show \d+ more/.test(candidate.textContent));
  if (more instanceof HTMLButtonElement) click(more);
}

function analysisPanel(): HTMLElement {
  const panel = document.querySelector<HTMLElement>('section[aria-label="Viewed player analysis"]');
  if (!panel) throw new Error('Analysis panel is not rendered');
  return panel;
}

describe('Assistant view tabs', () => {
  it('points only the selected tab at its rendered panel', () => {
    renderPage('live');
    const tabs = () => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"][id^="rec-view-"]')];
    const check = () => {
      for (const tab of tabs()) {
        const controls = tab.getAttribute('aria-controls');
        if (tab.getAttribute('aria-selected') === 'true') expect(controls && document.getElementById(controls)).toBeTruthy();
        else expect(controls).toBeNull();
      }
    };
    check();
    click(button('Position tiers'));
    check();
  });
});

describe('Assistant navigation to a player the catalog no longer has', () => {
  it('says so beside the leader instead of silently showing someone else, until another player is picked', () => {
    renderPage('live', { initialSelectedPlayerId: 'player-no-longer-in-catalog' });
    const notice = analysisPanel().querySelector('[data-missing-selection]');
    expect(notice?.textContent).toBe('That player isn\u2019t available any more.');
    expect(notice?.getAttribute('role')).toBe('status');
    const leader = container.querySelector('.suggestion-list .suggestion-row h3')?.textContent;
    expect(analysisPanel().querySelector('.rec-analysis-name')?.textContent).toBe(leader);
    expect(analysisPanel().querySelector('.rec-card-label')?.textContent).toMatch(/#1$/);
    const second = container.querySelectorAll<HTMLButtonElement>('.suggestion-list [data-suggestion-select]')[1];
    if (!second) throw new Error('No second card');
    click(second);
    expect(analysisPanel().querySelector('[data-missing-selection]')).toBeNull();
  });

  it('shows no notice for a known player or no selection', () => {
    renderPage('live', { initialSelectedPlayerId: null });
    expect(analysisPanel().querySelector('[data-missing-selection]')).toBeNull();
  });
});

describe('Assistant tier navigation', () => {
  it('keeps a tier player outside the recommendation limit as the viewed player and focuses the analysis', () => {
    renderPage('live');
    click(button('Position tiers'));
    const search = container.querySelector<HTMLInputElement>('#rec-view-panel-tiers input');
    if (!search) throw new Error('Tier search is not rendered');
    type(search, 'Receiver 100');
    click(button(/^Receiver 100/));

    const panel = analysisPanel();
    expect(panel.querySelector('h2')?.textContent).toBe('Receiver 100');
    // Degrades gracefully: what is known, plainly marked, and the player stays queueable.
    expect(panel.textContent).toContain('Limited analysis.');
    expect(panel.textContent).toContain('not in top 8');
    expect(panel.textContent).toContain('90%');
    expect(panel.querySelector('button[aria-label="Add Receiver 100 to queue"]')).not.toBeNull();
    expect(panel.textContent).not.toContain('Receiver 1 ');
    expect(document.activeElement).toBe(panel);
  });

  it('shows the model estimate on rows past the recommendation shortlist, and Final on the last pick', () => {
    renderPage('live');
    click(button('Position tiers'));
    const search = container.querySelector<HTMLInputElement>('#rec-view-panel-tiers input');
    if (!search) throw new Error('Tier search is not rendered');
    type(search, 'Receiver 95');
    const deep = (): HTMLElement | null => container.querySelector<HTMLElement>('.rec-tier-column[data-key="WR"] [data-tier-player-id="wr-95"]');
    // WR #95 has no recommendation, but the survival model estimates every available player, as the pool shows.
    expect(deep()?.querySelector('.rec-candidate-value')?.textContent).toBe('90%');

    act(() => { draftStore.getState().setConfig({ totalTeams: 2, totalRounds: 1, myPickPosition: 1 }); });
    renderPage('live');
    click(button('Position tiers'));
    const finalSearch = container.querySelector<HTMLInputElement>('#rec-view-panel-tiers input');
    if (!finalSearch) throw new Error('Tier search is not rendered');
    type(finalSearch, 'Receiver 95');
    expect(deep()?.querySelector('.rec-candidate-value')?.textContent).toContain('Final');
    expect(container.querySelector('.rec-tier-column[data-key="WR"] [data-tier-player-id="wr-5"] .rec-candidate-value')?.textContent ?? 'Final').toContain('Final');
    act(() => { draftStore.getState().setConfig({ totalTeams: 12, totalRounds: 15, myPickPosition: 1 }); });
  });

  it('declares exactly the tracks of the columns a sparse search renders', () => {
    renderPage('live');
    click(button('Position tiers'));
    const search = container.querySelector<HTMLInputElement>('#rec-view-panel-tiers input');
    if (!search) throw new Error('Tier search is not rendered');
    type(search, 'Receiver 95');
    const sheet = container.querySelector<HTMLElement>('.rec-tier-columns');
    expect(sheet?.querySelectorAll(':scope > .rec-tier-column')).toHaveLength(2);
    expect(sheet?.getAttribute('data-count')).toBe('2');
    expect(sheet?.style.getPropertyValue('--tier-rest-tracks')).toBe('1');
  });

  it('keeps the cheat sheet, its search and the selection mounted beside the analysis', () => {
    renderPage('live');
    click(button('Position tiers'));
    const search = container.querySelector<HTMLInputElement>('#rec-view-panel-tiers input');
    if (!search) throw new Error('Tier search is not rendered');
    type(search, 'Receiver 3');
    click(button(/^Receiver 3/));
    expect(container.querySelector('#rec-view-panel-tiers .rec-tiers')).not.toBeNull();
    expect(container.querySelector<HTMLInputElement>('#rec-view-panel-tiers input')?.value).toBe('Receiver 3');
    expect(container.querySelector('#rec-view-panel-tiers [data-selected="true"]')?.textContent).toContain('Receiver 3');
    click(button('Close analysis'));
    expect(container.querySelector('section[aria-label="Viewed player analysis"]')).toBeNull();
  });

  it('shows the analysis of a ranked tier player', () => {
    renderPage('live');
    click(button('Position tiers'));
    click(button(/^Receiver 3/));
    expect(analysisPanel().querySelector('h2')?.textContent).toBe('Receiver 3');
    expect(analysisPanel().textContent).toContain('Viewing · #3 overall');
    expect(analysisPanel().textContent).not.toContain('Analysis unavailable');
  });
});

describe('Assistant tier analysis focus and live text', () => {
  function tierSearch(): HTMLInputElement {
    const search = container.querySelector<HTMLInputElement>('#rec-view-panel-tiers .rec-search input');
    if (!search) throw new Error('Tier search is not rendered');
    return search;
  }

  it('returns focus to the originating tier row when the analysis closes', () => {
    renderPage('live');
    click(button('Position tiers'));
    click(button(/^Receiver 3/));
    click(button('Close analysis'));
    expect(document.activeElement?.closest('[data-tier-player-id]')?.getAttribute('data-tier-player-id')).toBe('wr-3');
    expect(document.activeElement?.classList.contains('rec-tier-identity')).toBe(true);
  });

  it('returns focus to the position-column copy when the player also appears in Overall', () => {
    renderPage('live');
    click(button('Position tiers'));
    const copies = [...container.querySelectorAll<HTMLButtonElement>('[data-tier-player-id="wr-3"] .rec-tier-identity')];
    const positionCopy = copies.find((copy) => copy.closest('.rec-tier-column')?.getAttribute('data-key') === 'WR');
    expect(copies.length).toBeGreaterThan(1);
    if (!positionCopy) throw new Error('Missing WR column copy');
    click(positionCopy);
    click(button('Close analysis'));
    expect(document.activeElement).toBe(positionCopy);
  });

  it('falls back to the tier search when the originating row has gone', () => {
    renderPage('live');
    click(button('Position tiers'));
    type(tierSearch(), 'Receiver 3');
    click(button(/^Receiver 3/));
    type(tierSearch(), 'Receiver 4');
    click(button('Close analysis'));
    expect(document.activeElement).toBe(tierSearch());
  });

  it('closes on Escape with the same focus return', () => {
    renderPage('live');
    click(button('Position tiers'));
    click(button(/^Receiver 5/));
    act(() => { analysisPanel().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(container.querySelector('section[aria-label="Viewed player analysis"]')).toBeNull();
    expect(document.activeElement?.closest('[data-tier-player-id]')?.getAttribute('data-tier-player-id')).toBe('wr-5');
  });

  it('drops a stale tier analysis when the assistant view changes', () => {
    renderPage('live');
    click(button('Position tiers'));
    click(button(/^Receiver 3/));
    click(button('Suggestions'));
    click(button('Position tiers'));
    expect(container.querySelector('.rec-tiers-analysis')).toBeNull();
  });

  it('announces only a short sentence for the viewed player, never the whole analysis', () => {
    renderPage('live');
    click(button('Position tiers'));
    click(button(/^Receiver 3/));
    const panel = analysisPanel();
    expect(panel.querySelector('[role="tabpanel"]')?.hasAttribute('aria-live')).toBe(false);
    expect([...panel.querySelectorAll('[aria-live]')].map((node) => node.textContent)).toEqual(['Showing analysis for Receiver 3']);
  });

  it('keeps a Draft action beside the tier analysis in Quick Mock', () => {
    renderPage('mock');
    click(button('Position tiers'));
    click(button(/^Receiver 3/));
    const draft = analysisPanel().querySelector<HTMLButtonElement>('button[aria-label="Draft Receiver 3"]');
    if (!draft) throw new Error('Missing analysis Draft action');
    click(draft);
    expect(mocks.draftPlayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'wr-3' }));
  });

  it('offers Record beside the analysis in live Manual Continuity', () => {
    mocks.synchronizationState = 'manual-continuity';
    renderPage('live');
    click(button('Position tiers'));
    click(button(/^Receiver 3/));
    const record = analysisPanel().querySelector<HTMLButtonElement>('button[aria-label="Record Receiver 3 as a provisional pick"]');
    if (!record) throw new Error('Missing analysis Record action');
    click(record);
    expect(document.querySelector<HTMLSelectElement>('select[aria-label="Observed player"]')?.value).toBe('wr-3');
  });
});

describe('Assistant main action by draft mode', () => {
  it('names the connected provider in Companion guidance and shows the Sleeper autopick note only for Sleeper', () => {
    renderPage('live');
    expect(container.textContent).toContain('Make the pick in Sleeper.');
    expect(container.textContent).toContain('Sleeper autopick uses your Sleeper queue.');
    // Companion never submits: the top suggestion's action is Queue.
    expect(labelled('Add Receiver 1 to queue')).toBeTruthy();

    mocks.provider = 'espn';
    renderPage('live');
    expect(container.textContent).toContain('Make the pick in ESPN.');
    expect(container.textContent).not.toContain('autopick');
  });

  it('shows one analysis area for card #1 by default, and switches its subject when another card is picked', () => {
    renderPage('live');
    const cards = container.querySelector('ol[aria-label="Suggested picks, best first"]');
    expect(cards?.querySelectorAll(':scope > li > article')).toHaveLength(4);
    expect(container.querySelectorAll('section[aria-label="Viewed player analysis"]')).toHaveLength(1);
    expect(container.textContent).not.toContain('Deep analysis');
    expect(analysisPanel().querySelector('h2')?.textContent).toBe('Receiver 1');

    const second = cards?.querySelectorAll<HTMLElement>(':scope > li > article')[1];
    if (!second) throw new Error('No second card');
    click(second);
    expect(analysisPanel().querySelector('h2')?.textContent).toBe(second.querySelector('h3')?.textContent);
    expect(second.querySelector('.suggestion-select')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('gives each card a named selection button that carries the selection, beside independent Draft and Queue', () => {
    renderPage('mock');
    const select = labelled('View analysis for Receiver 3');
    expect(select.getAttribute('aria-pressed')).toBe('false');
    click(select);
    expect(analysisPanel().querySelector('h2')?.textContent).toBe('Receiver 3');
    expect(select.getAttribute('aria-pressed')).toBe('true');
    expect(labelled('View analysis for Receiver 1').getAttribute('aria-pressed')).toBe('false');
    // Draft and Queue are separate controls: neither changes the analysis subject.
    click(labelled('Add Receiver 2 to queue'));
    expect(analysisPanel().querySelector('h2')?.textContent).toBe('Receiver 3');
    // The selection button is a shortcut target, so 1-4 still act from it.
    act(() => { select.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true })); });
    expect(mocks.draftPlayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'wr-1' }));
  });

  it('keeps exactly one take-now-or-wait block through repeated selection, layout and view changes', () => {
    renderPage('mock');
    const decisionBlocks = (): number => container.querySelectorAll('.rec-decision').length;
    const subject = (): string | null | undefined => container.querySelector('.rec-decision')?.getAttribute('data-decision-subject');
    expect(decisionBlocks()).toBe(1);
    for (let round = 0; round < 3; round += 1) {
      for (const name of ['Receiver 2', 'Receiver 3', 'Receiver 4', 'Receiver 1']) {
        click(labelled(`View analysis for ${name}`));
        expect(decisionBlocks()).toBe(1);
        expect(analysisPanel().querySelector('h2')?.textContent).toBe(name);
        expect(subject()).toBe(`wr-${name.split(' ')[1] ?? ''}`);
      }
      // A layout change: a window resize, then the tier view and back, which remounts the analysis.
      act(() => { window.dispatchEvent(new Event('resize')); });
      click(button('Position tiers'));
      click(button('Suggestions'));
      expect(decisionBlocks()).toBe(1);
    }
    // Every card shows its availability, the selected one included, so the four compare at a glance. The analysis
    // states cost of waiting and the fallback once, and refers to availability once in its secondary style.
    expect(container.querySelectorAll('.suggestion-row [data-card-availability] strong')).toHaveLength(4);
    expect(container.querySelector('.suggestion-row[data-selected] [data-card-availability] strong')?.textContent).toMatch(/^\d+%$/);
    // The card's figure is the only availability display; the analysis adds what waiting costs instead.
    expect(container.querySelectorAll('[data-availability]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-roster-fit]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-risk]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-waiting-cost]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-fallback]')).toHaveLength(1);
  });

  it('shows search matches in place of the four cards, and brings the cards back when the search clears', () => {
    renderPage('live');
    const search = container.querySelector<HTMLInputElement>('#rec-view-panel-suggestions .rec-search input');
    if (!search) throw new Error('No search');
    type(search, 'Receiver 7');
    expect(container.querySelector('ol[aria-label="Suggested picks, best first"]')).toBeNull();
    expect(container.querySelector('#rec-pool-heading')?.textContent).toBe('Search results');
    expect(container.querySelector('.rec-pool-list')?.textContent).toContain('Receiver 7');
    click(labelled('Clear search'));
    expect(search.value).toBe('');
    expect(container.querySelectorAll('ol[aria-label="Suggested picks, best first"] > li')).toHaveLength(4);
  });

  it('searches every available player, the model\'s shortlists and the players deeper than them', () => {
    renderPage('mock');
    const search = container.querySelector<HTMLInputElement>('#rec-view-panel-suggestions .rec-search input');
    if (!search) throw new Error('No search');
    // Receiver 50 is ranked only in the WR list, far below the 8-player overall list.
    type(search, 'Receiver 50');
    expect(container.querySelector('.rec-pool-list')?.textContent).toContain('Receiver 50');
    // Receiver 100 is beyond the 60-player cap: no analysis, but found, marked, draftable and queueable.
    type(search, 'Receiver 100');
    const row = container.querySelector<HTMLElement>('.rec-pool-list [data-pool-player="wr-100"]');
    expect(row?.textContent).toContain('Limited analysis');
    expect(row?.querySelector('.rec-candidate-rank')?.textContent).toContain('Not in the top 8 overall');
    const draft = row?.querySelector<HTMLButtonElement>('button[aria-label="Draft Receiver 100"]');
    if (!draft) throw new Error('No Draft on the deep row');
    click(draft);
    expect(mocks.draftPlayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'wr-100' }));
    click(labelled('Add Receiver 100 to queue'));
    expect(mocks.togglePlayerQueued).toHaveBeenCalledWith('wr-100');
  });

  it('orders search results with ranked players first, then unranked ones after them', () => {
    renderPage('live');
    const search = container.querySelector<HTMLInputElement>('#rec-view-panel-suggestions .rec-search input');
    if (!search) throw new Error('No search');
    // Receiver 1, Receiver 10-19 and Receiver 100: overall-ranked first, WR-only next, unranked last.
    type(search, 'Receiver 1');
    showAllPlayers();
    const ids = [...container.querySelectorAll('.rec-pool-list [data-pool-player]')].map((row) => row.getAttribute('data-pool-player'));
    expect(ids[0]).toBe('wr-1');
    expect(ids.at(-1)).toBe('wr-100');
    expect(ids.indexOf('wr-10')).toBeLessThan(ids.indexOf('wr-100'));
  });

  it('never changes a player\'s displayed rank when the list is searched or filtered', () => {
    renderPage('live');
    const rankOf = (id: string): string | null | undefined => container.querySelector(`.rec-pool-list [data-pool-player="${id}"] .rec-candidate-rank [aria-hidden="true"]`)?.textContent;
    const announcedRankOf = (id: string): string | null | undefined => container.querySelector(`.rec-pool-list [data-pool-player="${id}"] .rec-candidate-rank .sr-only`)?.textContent;
    // Unfiltered, Receiver 7 is #7 overall.
    showAllPlayers();
    expect(rankOf('wr-7')).toBe('7');
    const search = container.querySelector<HTMLInputElement>('#rec-view-panel-suggestions .rec-search input');
    if (!search) throw new Error('No search');
    type(search, 'Receiver 7');
    // The only match (with Receiver 70-79), still shown and announced as #7, never "Rank 1".
    expect(rankOf('wr-7')).toBe('7');
    expect(announcedRankOf('wr-7')).toBe('Overall rank 7');
    click(labelled('Clear search'));
    click(labelled('WR, 2 of 2 filled'));
    showAllPlayers();
    expect(rankOf('wr-7')).toBe('7');
    expect(announcedRankOf('wr-7')).toBe('Overall rank 7');
  });

  it('lets a player found by search be compared with anyone the model analyses', () => {
    renderPage('live');
    const search = container.querySelector<HTMLInputElement>('#rec-view-panel-suggestions .rec-search input');
    if (!search) throw new Error('No search');
    type(search, 'Receiver 50');
    const result = container.querySelector<HTMLButtonElement>('.rec-pool-list [data-pool-player="wr-50"] [data-pool-select]');
    if (!result) throw new Error('No search result');
    click(result);
    click(button('Compare'));
    click(labelled('Change comparison player'));
    // Receiver 40 is ranked only in the WR list, like the subject: it is a valid second player.
    const option = [...document.querySelectorAll<HTMLButtonElement>('ul[aria-label="Comparison players"] button')].find((candidate) => candidate.textContent.includes('Receiver 40'));
    if (!option) throw new Error('Receiver 40 is not offered for comparison');
    click(option);
    expect(analysisPanel().querySelector('.rec-compare')?.textContent).toContain('Receiver 40');
    expect(analysisPanel().querySelector('.rec-compare')?.textContent).toContain('Receiver 50');
    // Neither has an overall rank, so the model's score decides, not the slot order.
    expect(analysisPanel().querySelector('.rec-answer-title')?.textContent).toBe('Receiver 40 grades ahead of Receiver 50 for this pick.');
  });

  it('marks an unranked search result as the viewed row', () => {
    renderPage('live');
    const search = container.querySelector<HTMLInputElement>('#rec-view-panel-suggestions .rec-search input');
    if (!search) throw new Error('No search');
    type(search, 'Receiver 100');
    const select = container.querySelector<HTMLButtonElement>('.rec-pool-list [data-pool-player="wr-100"] [data-pool-select]');
    if (!select) throw new Error('No search result');
    click(select);
    expect(select.getAttribute('aria-pressed')).toBe('true');
    expect(select.textContent).toContain('Viewing');
  });

  it('keeps an unranked search result highlighted as Viewing on the Compare tab, which has no pair for it', () => {
    renderPage('live');
    click(button('Compare'));
    const search = container.querySelector<HTMLInputElement>('#rec-view-panel-suggestions .rec-search input');
    if (!search) throw new Error('No search');
    type(search, 'Receiver 100');
    const select = container.querySelector<HTMLButtonElement>('.rec-pool-list [data-pool-player="wr-100"] [data-pool-select]');
    if (!select) throw new Error('No search result');
    click(select);
    expect(select.getAttribute('aria-pressed')).toBe('true');
    expect(select.textContent).toContain('Viewing');
    expect(select.textContent).not.toContain('Comparing');
  });

  it('opens Full reasoning in the analysis Why tab instead of growing the card', () => {
    renderPage('live');
    // Only the leader's card carries the link; selecting any other card shows its analysis beside the list.
    const toggles = container.querySelectorAll<HTMLButtonElement>('.suggestion-row .suggestion-reason-toggle');
    expect(toggles).toHaveLength(1);
    const toggle = container.querySelector<HTMLButtonElement>('.suggestion-row[data-lead] .suggestion-reason-toggle');
    if (!toggle) throw new Error('No Full reasoning');
    const leader = /^Full reasoning for (.+)$/.exec(toggle.getAttribute('aria-label') ?? '')?.[1];
    click(toggle);
    expect(analysisPanel().querySelector('h2')?.textContent).toBe(leader);
    expect(container.querySelector('#rec-tab-why')?.getAttribute('aria-selected')).toBe('true');
    expect(analysisPanel().querySelector('details[data-full-reasoning]')?.hasAttribute('open')).toBe(true);
    // Nothing inside the card expands.
    expect(container.querySelector('.suggestion-row [aria-expanded], .suggestion-reason-detail')).toBeNull();
    // Collapsed by hand, the next Full reasoning opens it again.
    act(() => { analysisPanel().querySelector('details[data-full-reasoning]')?.removeAttribute('open'); });
    click(toggle);
    expect(analysisPanel().querySelector('details[data-full-reasoning]')?.hasAttribute('open')).toBe(true);
  });

  it('moves through search results with the arrow keys and focuses the search with /', () => {
    renderPage('live');
    const search = container.querySelector<HTMLInputElement>('#rec-view-panel-suggestions .rec-search input');
    if (!search) throw new Error('No search');
    act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true })); });
    expect(document.activeElement).toBe(search);
    type(search, 'Receiver 2');
    act(() => { search.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })); });
    const rows = [...container.querySelectorAll<HTMLButtonElement>('.rec-pool-list [data-pool-select]')];
    expect(document.activeElement).toBe(rows[0]);
    act(() => { rows[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })); });
    expect(document.activeElement).toBe(rows[1]);
    // A held Enter does nothing more; a held Q toggles the queue once.
    const repeatEnter = new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true });
    act(() => { rows[1]?.dispatchEvent(repeatEnter); });
    expect(repeatEnter.defaultPrevented).toBe(true);
    mocks.togglePlayerQueued.mockClear();
    act(() => { rows[1]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', bubbles: true, cancelable: true })); });
    act(() => { rows[1]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', repeat: true, bubbles: true, cancelable: true })); });
    expect(mocks.togglePlayerQueued).toHaveBeenCalledTimes(1);
    act(() => { rows[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })); });
    expect(document.activeElement).toBe(search);
  });

  it('states each analysis fact once: availability, waiting cost and value', () => {
    renderPage('live');
    const text = analysisPanel().textContent;
    const count = (pattern: RegExp): number => text.match(pattern)?.length ?? 0;
    expect(count(/\d+% /g) + count(/\d+%$/g)).toBeLessThanOrEqual(1);
    expect(count(/VOR [+-]\d/g)).toBeLessThanOrEqual(1);
    expect(count(/Cost of waiting/g)).toBe(1);
  });

  it('acts on 1-4 only when focus is on the list or a card, never on a control inside a card', () => {
    renderPage('mock');
    const toggle = container.querySelector<HTMLButtonElement>('ol[aria-label="Suggested picks, best first"] .suggestion-reason-toggle');
    if (!toggle) throw new Error('No Full reasoning toggle');
    act(() => { toggle.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true })); });
    expect(mocks.draftPlayer).not.toHaveBeenCalled();
    const card = container.querySelector<HTMLElement>('ol[aria-label="Suggested picks, best first"] article');
    if (!card) throw new Error('No card');
    act(() => { card.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true })); });
    expect(mocks.draftPlayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'wr-1' }));
  });

  describe('page-wide 1-4 while on the clock', () => {
    const pressOn = (target: EventTarget, key: string): KeyboardEvent => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      act(() => { target.dispatchEvent(event); });
      return event;
    };

    // jsdom has no layout: give every element an on-screen box, so the keys see the cards as visible.
    const laidOut = (): void => {
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 200, top: 200, left: 0, bottom: 288, right: 300, width: 300, height: 88, toJSON: () => ({}) } as DOMRect);
    };

    it('acts on the card from anywhere on the page, without focusing the list first, and shows the hint', () => {
      laidOut();
      renderPage('mock');
      expect(container.querySelector('.rec-lead-heading .suggestion-shortcut-hint')?.textContent).toBe('Press 1–4');
      expect(pressOn(document.body, '2').defaultPrevented).toBe(true);
      expect(mocks.draftPlayer).toHaveBeenCalledTimes(1);
      expect(mocks.draftPlayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'wr-2' }));
    });

    it('never fires from a text input, with a dialog open, or while a pick is saving', () => {
      renderPage('mock');
      const search = container.querySelector<HTMLInputElement>('.rec-search input');
      if (!search) throw new Error('No search');
      act(() => { search.focus(); });
      expect(pressOn(search, '1').defaultPrevented).toBe(false);
      act(() => { search.blur(); });

      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      document.body.append(dialog);
      pressOn(document.body, '1');
      dialog.remove();
      expect(mocks.draftPlayer).not.toHaveBeenCalled();

      mocks.pickInFlight = true;
      renderPage('mock');
      pressOn(document.body, '1');
      expect(mocks.draftPlayer).not.toHaveBeenCalled();
    });

    it('never acts on a card that is not on screen: search results replace the cards, or the tier view is open', () => {
      laidOut();
      renderPage('mock');
      const search = container.querySelector<HTMLInputElement>('#rec-view-panel-suggestions .rec-search input');
      if (!search) throw new Error('No search');
      type(search, 'Receiver 7');
      expect(container.querySelector('ol[aria-label="Suggested picks, best first"]')).toBeNull();
      // Focus leaves the input (a result row was clicked), then 2: card #2 is hidden, so nothing is drafted.
      act(() => { search.blur(); });
      expect(container.querySelector('.rec-lead-hint')?.hasAttribute('data-hidden')).toBe(true);
      for (const key of ['1', '2', '3', '4']) expect(pressOn(document.body, key).defaultPrevented).toBe(false);
      click(labelled('Clear search'));

      click(button('Position tiers'));
      act(() => { (document.activeElement as HTMLElement | null)?.blur(); });
      for (const key of ['1', '2', '3', '4']) expect(pressOn(document.body, key).defaultPrevented).toBe(false);
      expect(mocks.draftPlayer).not.toHaveBeenCalled();
    });

    it('stays out of the page when it is not the manager\'s turn', () => {
      act(() => { draftStore.getState().setConfig({ myPickPosition: 2 }); });
      renderPage('mock');
      expect(pressOn(document.body, '1').defaultPrevented).toBe(false);
      expect(mocks.draftPlayer).not.toHaveBeenCalled();
    });
  });

  it('drafts the leader in Quick Mock', () => {
    renderPage('mock');
    click(labelled('Draft Receiver 1'));
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
    click(button('Roster needs'));
    expect(analysisPanel().textContent).toContain('Fills an open FLEX starter slot.');
    expect(analysisPanel().textContent).not.toContain('This adds depth');
  });
});
