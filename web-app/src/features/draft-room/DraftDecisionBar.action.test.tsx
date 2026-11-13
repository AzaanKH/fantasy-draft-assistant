// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Recommendation } from '@fantasy-draft/shared/draft';
import { TooltipProvider } from '@/components/ui/tooltip';
import { createDraftStore } from '@/stores/draftStore';
import { VISUAL_PLAYER_DATA } from '@/visual/VisualApp';
import { WorkspaceTestProvider } from '@/workspace/workspace-test-helpers';
import { DraftDecisionBar } from './DraftDecisionBar';

const bestPick: Recommendation = { playerId: 'best-pick', playerName: 'Best Pick', position: 'RB', reason: 'critical roster need', score: 12 };
const state = vi.hoisted(() => ({ canDraft: false, pickInFlight: false, synchronizationState: 'confirmed', draftPlayer: vi.fn() }));
vi.mock('@/hooks/usePlayerData', () => ({ usePlayerDataQuery: () => ({ ...VISUAL_PLAYER_DATA, players: [{ ...VISUAL_PLAYER_DATA.players[0], id: 'best-pick', name: 'Best Pick', position: 'RB' }], isLoading: false }) }));
vi.mock('@/features/recommendations/DraftDecisionContext', () => ({
  useDraftDecision: () => ({ output: { bestPick }, isLoading: false, recommendationsBlocked: false }),
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
  Object.assign(state, { canDraft: false, pickInFlight: false, synchronizationState: 'confirmed' });
  state.draftPlayer.mockClear();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => { root.unmount(); }); container.remove(); vi.unstubAllGlobals(); });

function render(sessionMode: 'setup' | 'mock' | 'live'): void {
  const store = createDraftStore();
  store.getState().setSessionMode(sessionMode);
  act(() => { root.render(createElement(WorkspaceTestProvider, { store, children: createElement(TooltipProvider, null, createElement(DraftDecisionBar, { onOpenAssistant: vi.fn() })) })); });
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
