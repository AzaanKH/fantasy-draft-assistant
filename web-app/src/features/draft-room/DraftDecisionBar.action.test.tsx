// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DecisionLens, Recommendation } from '@fantasy-draft/shared/draft';
import { TooltipProvider } from '@/components/ui/tooltip';
import { createDraftStore } from '@/stores/draftStore';
import { VISUAL_PLAYER_DATA } from '@/visual/VisualApp';
import { WorkspaceTestProvider } from '@/workspace/workspace-test-helpers';
import { DraftDecisionBar } from './DraftDecisionBar';

const bestPick: Recommendation = { playerId: 'best-pick', playerName: 'Best Pick', position: 'RB', reason: 'critical roster need', score: 12 };
const rankedFit: Recommendation = { playerId: 'ranked-fit', playerName: 'Ranked Fit Player', position: 'WR', reason: 'Trusted ECR Anchor #3 among players who keep a legal roster', score: -3 };
const state = vi.hoisted(() => ({ canDraft: false, pickInFlight: false, synchronizationState: 'confirmed', draftPlayer: vi.fn(), lens: 'best-pick' as DecisionLens, onOpenAssistant: vi.fn() }));
vi.mock('@/hooks/usePlayerData', () => ({ usePlayerDataQuery: () => ({ ...VISUAL_PLAYER_DATA, players: [
  { ...VISUAL_PLAYER_DATA.players[0], id: 'best-pick', name: 'Best Pick', position: 'RB' },
  { ...VISUAL_PLAYER_DATA.players[0], id: 'ranked-fit', name: 'Ranked Fit Player', position: 'WR' },
], isLoading: false }) }));
vi.mock('@/features/recommendations/DraftDecisionContext', () => ({
  useDraftDecision: () => ({
    output: { bestPick, rankedFit, selectedLens: state.lens, selected: state.lens === 'best-pick' ? bestPick : rankedFit },
    isLoading: false,
    recommendationsBlocked: false,
  }),
}));
vi.mock('@/hooks/useQueueActions', () => ({ useQueueActions: () => ({ togglePlayerQueued: vi.fn() }) }));
vi.mock('@/features/draft-room/LiveDraftSyncProvider', () => ({ useLiveDraftSync: () => ({ synchronizationState: state.synchronizationState }) }));
vi.mock('@/hooks/useDraftPlayerAction', () => ({
  useDraftPlayerAction: () => ({ canDraft: state.canDraft, canDraftPlayer: () => state.canDraft, isMyTurn: state.canDraft, draftPlayer: state.draftPlayer, draftStatus: null, pickInFlight: state.pickInFlight, origin: 'bar' }),
}));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.assign(state, { canDraft: false, pickInFlight: false, synchronizationState: 'confirmed', lens: 'best-pick' });
  state.draftPlayer.mockClear();
  state.onOpenAssistant.mockClear();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => { root.unmount(); }); container.remove(); vi.unstubAllGlobals(); });

function render(sessionMode: 'setup' | 'mock' | 'live'): void {
  const store = createDraftStore();
  store.getState().setSessionMode(sessionMode);
  act(() => { root.render(createElement(WorkspaceTestProvider, { store, children: createElement(TooltipProvider, null, createElement(DraftDecisionBar, { onOpenAssistant: state.onOpenAssistant })) })); });
}
const labelled = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

it('drafts the Best Pick in one step on your turn in a mock, beside Queue and Why', () => {
  state.canDraft = true;
  render('mock');
  const draft = labelled('Draft Best Pick');
  expect(draft).not.toBeNull();
  expect(labelled('Add Best Pick to queue')).not.toBeNull();
  act(() => { draft?.click(); });
  expect(state.draftPlayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'best-pick' }));
});

it('records a provisional pick during Manual Continuity, and waits while another pick saves', () => {
  state.synchronizationState = 'manual-continuity';
  state.pickInFlight = true;
  render('live');
  expect(labelled('Record Best Pick as a provisional pick')?.disabled).toBe(true);
});

it('offers no Draft when it is not your turn', () => {
  render('mock');
  expect(labelled('Draft Best Pick')).toBeNull();
  expect(labelled('Add Best Pick to queue')).not.toBeNull();
});

it('shows, drafts, queues and explains the active lens pick, not Best Pick', () => {
  state.canDraft = true;
  state.lens = 'ranked-fit';
  render('mock');
  const bar = container.querySelector('section[aria-label="Current recommendation"]');
  expect(bar?.textContent).toContain('Ranked Fit');
  expect(bar?.textContent).toContain('Ranked Fit Player');
  expect(bar?.textContent).not.toContain('Best Pick');
  expect(labelled('Add Ranked Fit Player to queue')).not.toBeNull();
  act(() => { labelled('Draft Ranked Fit Player')?.click(); });
  expect(state.draftPlayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'ranked-fit' }));
  const why = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Why this pick'));
  act(() => { why?.click(); });
  expect(state.onOpenAssistant).toHaveBeenCalledWith({ lens: 'why', selectedPlayerId: 'ranked-fit' });
});
