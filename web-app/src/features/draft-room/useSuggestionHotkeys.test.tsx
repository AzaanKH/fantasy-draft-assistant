// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asProbability, asRank, asVor } from '@fantasy-draft/shared/units';
import type { Player } from '@fantasy-draft/shared/league';
import type { DraftDecisionView, Recommendation } from '@fantasy-draft/shared/draft';
import { TooltipProvider } from '@/components/ui/tooltip';
import { createDraftStore } from '@/stores/draftStore';
import { VISUAL_PLAYERS } from '@/visual/VisualApp';
import { WorkspaceTestProvider } from '@/workspace/workspace-test-helpers';
import { DraftDock } from './DraftDock';
import { storeSuggestionShortcutScope, SUGGESTION_SHORTCUT_STORAGE_KEY } from './suggestion-shortcut-preference';
import { SuggestionHotkeys } from './useSuggestionHotkeys';
import { SuggestionActionsProvider } from './SuggestionActionsContext';

function player(index: number): Player {
  const base = VISUAL_PLAYERS[0];
  if (!base) throw new Error('Missing player fixture');
  return { ...base, id: `wr-${String(index)}`, name: `Receiver ${String(index)}`, position: 'WR', ecrRank: asRank(index) };
}
function recommendation(source: Player, rank: number): Recommendation {
  return {
    playerId: source.id, playerName: source.name, position: source.position, reason: 'Next-pick timing', score: 100 - rank,
    diagnostics: {
      expertRank: asRank(rank), marketRank: rank, marketDelta: 0, projectedPoints: 250 - rank, valueOverReplacement: asVor(60 - rank),
      tier: 1, tierRemaining: 3, nextPickSurvivalProbability: asProbability(0.4), nextPickNumber: 24, nextPickLabel: '2.12',
    },
  };
}
const players = Array.from({ length: 6 }, (_, index) => player(index + 1));
const recommendations = players.map((item, index) => recommendation(item, index + 1));
const overall: DraftDecisionView = {
  recommendations, preferred: recommendations[0] ?? null,
  rankByPlayerId: new Map(recommendations.map((item, index) => [item.playerId, index + 1])),
  explanationByPlayerId: new Map(), selection: {} as DraftDecisionView['selection'],
};

const mocks = vi.hoisted(() => ({ draftPlayer: vi.fn(), pickInFlight: false }));
vi.mock('@/features/recommendations/DraftDecisionContext', () => ({
  useDraftDecision: () => ({
    isLoading: false, recommendationsBlocked: false, recommendationsBlockedByProviderIdentity: false, readiness: null,
    overall, byPosition: {}, output: { bestPick: overall.preferred, selectedLens: 'best-pick' }, setSelectedLens: vi.fn(),
  }),
}));
vi.mock('@/features/draft-room/LiveDraftSyncProvider', () => ({ useLiveDraftSync: () => ({ synchronizationState: 'confirmed' }) }));
vi.mock('@/hooks/usePlayerData', () => ({ usePlayerDataQuery: () => ({ players, isLoading: false }) }));
vi.mock('@/hooks/useTeamNeeds', () => ({ useTeamNeeds: () => ({ needs: [] }) }));
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => true }));
vi.mock('@/hooks/useDraftPlayerAction', () => ({
  useDraftPlayerAction: () => ({ canDraft: true, canDraftPlayer: () => true, isMyTurn: true, draftPlayer: mocks.draftPlayer, draftStatus: null, pickInFlight: mocks.pickInFlight, origin: 'test' }),
}));
vi.mock('@/hooks/useQueueActions', () => ({ useQueueActions: () => ({ togglePlayerQueued: vi.fn(), removePlayerFromQueue: vi.fn() }) }));
// The dock's other panels are not under test; stand-ins keep the tabs real.
vi.mock('./DraftPlayerPool', () => ({ DraftPlayerPool: () => createElement('div', null, 'Pool') }));
vi.mock('./DraftRosterPanel', () => ({ DraftRosterPanel: () => createElement('div', { 'data-testid': 'roster' }, 'Roster') }));
vi.mock('./DraftQueuePanel', () => ({ DraftQueuePanel: () => createElement('div', null, 'Queue') }));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  window.localStorage.removeItem(SUGGESTION_SHORTCUT_STORAGE_KEY);
  storeSuggestionShortcutScope('anywhere');
  mocks.draftPlayer.mockClear();
  mocks.pickInFlight = false;
  const store = createDraftStore();
  store.getState().setConfig({ totalTeams: 12, totalRounds: 15, myPickPosition: 1, draftType: 'snake' });
  store.getState().setSessionMode('mock');
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  act(() => {
    root.render(createElement(WorkspaceTestProvider, { store, children: createElement(TooltipProvider, null, createElement(SuggestionActionsProvider, null,
      createElement(DraftDock, { expanded: true, onExpandedChange: vi.fn(), onOpenAssistant: vi.fn() }),
      createElement(SuggestionHotkeys))) }));
  });
});
afterEach(() => { act(() => { root.unmount(); }); container.remove(); vi.unstubAllGlobals(); window.localStorage.removeItem(SUGGESTION_SHORTCUT_STORAGE_KEY); });

const press = (target: EventTarget, key: string): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  act(() => { target.dispatchEvent(event); });
  return event;
};

it('drafts the matching suggestion for keys 1-4 while the dock shows Roster, with no suggestion list mounted', () => {
  expect(container.querySelector('[data-testid="roster"]')).not.toBeNull();
  expect(container.querySelector('[data-suggestion-list]')).toBeNull();
  for (const key of ['1', '2', '3', '4']) expect(press(document.body, key).defaultPrevented).toBe(true);
  expect(mocks.draftPlayer.mock.calls.map((call) => (call[0] as Player).id)).toEqual(['wr-1', 'wr-2', 'wr-3', 'wr-4']);
});

it('keeps the guards: not while typing, not with a dialog open, and not with focused-only shortcuts', () => {
  const input = document.createElement('input');
  document.body.append(input);
  act(() => { input.focus(); });
  expect(press(input, '1').defaultPrevented).toBe(false);
  input.remove();

  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  document.body.append(dialog);
  press(document.body, '1');
  dialog.remove();

  act(() => { storeSuggestionShortcutScope('focused'); });
  expect(press(document.body, '1').defaultPrevented).toBe(false);
  expect(mocks.draftPlayer).not.toHaveBeenCalled();
  expect(window.localStorage.getItem(SUGGESTION_SHORTCUT_STORAGE_KEY)).toBe('focused');
});

it('ignores a held key: its repeats never act again', () => {
  const event = new KeyboardEvent('keydown', { key: '1', repeat: true, bubbles: true, cancelable: true });
  act(() => { document.body.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(false);
  expect(mocks.draftPlayer).not.toHaveBeenCalled();
});

describe('on the Assistant, where the cards are the keys\' only targets', () => {
  const box = (height: number) => ({ x: 0, y: 200, top: 200, left: 0, bottom: 200 + height, right: 300, width: 300, height, toJSON: () => ({}) });
  function assistantPage({ cards, hint }: { readonly cards: readonly string[]; readonly hint: boolean }): HTMLElement {
    const main = document.createElement('main');
    main.setAttribute('data-suggestion-keys', '');
    if (hint) {
      const button = document.createElement('button');
      button.className = 'suggestion-shortcut-hint';
      button.getBoundingClientRect = () => box(18);
      main.append(button);
    }
    const list = document.createElement('ol');
    list.setAttribute('data-suggestion-list', '');
    for (const id of cards) {
      const item = document.createElement('li');
      item.setAttribute('data-suggestion-player', id);
      item.getBoundingClientRect = () => box(88);
      list.append(item);
    }
    main.append(list);
    document.body.append(main);
    return main;
  }

  it('acts only on a card that is rendered and on screen, with the hint showing', () => {
    const main = assistantPage({ cards: ['wr-2'], hint: true });
    // Card 1 is not rendered (search results or the tier view replaced it): nothing happens.
    expect(press(document.body, '1').defaultPrevented).toBe(false);
    expect(press(document.body, '2').defaultPrevented).toBe(true);
    expect(mocks.draftPlayer.mock.calls.map((call) => (call[0] as Player).id)).toEqual(['wr-2']);
    main.remove();
  });

  it('does nothing while the hint is hidden or the cards are scrolled out of view', () => {
    const noHint = assistantPage({ cards: ['wr-1', 'wr-2', 'wr-3', 'wr-4'], hint: false });
    for (const key of ['1', '2', '3', '4']) expect(press(document.body, key).defaultPrevented).toBe(false);
    noHint.remove();

    const scrolled = assistantPage({ cards: ['wr-1'], hint: true });
    const card = scrolled.querySelector('li');
    if (card) card.getBoundingClientRect = () => ({ ...box(88), top: -400, bottom: -312, y: -400 });
    expect(press(document.body, '1').defaultPrevented).toBe(false);
    expect(mocks.draftPlayer).not.toHaveBeenCalled();
    scrolled.remove();
  });
});
