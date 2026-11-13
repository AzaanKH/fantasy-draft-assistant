// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { NextPickAvailability } from '@/lib/next-pick-availability';
import { createDraftStore } from '@/stores/draftStore';
import { VISUAL_PLAYERS } from '@/visual/VisualApp';
import { WorkspaceTestProvider } from '@/workspace/workspace-test-helpers';
import { DraftPlayerPool } from './DraftPlayerPool';

const decision = vi.hoisted(() => ({ availability: new Map<string, NextPickAvailability>() }));
vi.mock('@/hooks/usePlayerData', () => ({ usePlayerDataQuery: () => ({ players: VISUAL_PLAYERS, isLoading: false }) }));
vi.mock('./LiveDraftSyncProvider', () => ({ useLiveDraftSync: () => ({ connection: null, synchronizationState: 'idle' }) }));
vi.mock('@/features/recommendations/DraftDecisionContext', () => ({
  useDraftDecision: () => ({ output: { selectedLens: 'best-pick' }, overall: { recommendations: [], rankByPlayerId: new Map() },
    readiness: null, recommendationsBlocked: false, nextPickAvailabilityById: decision.availability }),
}));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(900);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => { root.unmount(); }); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function availabilityCell(playerName: string): HTMLElement | undefined {
  const row = [...container.querySelectorAll<HTMLElement>('[data-player-row]')].find((candidate) => candidate.textContent.includes(playerName));
  // Rank, Player, Proj..., Value, Available next pick, Queue: the availability cell is second from the end.
  const cells = row ? [...row.querySelectorAll<HTMLElement>('[role="gridcell"]')] : [];
  return cells[cells.length - 2];
}

it('shows the model estimate, and never the catalog figure when there is no estimate or no later pick', () => {
  const [estimated, finalPick, unestimated] = VISUAL_PLAYERS;
  if (!estimated || !finalPick || !unestimated) throw new Error('Fixture needs three players');
  decision.availability = new Map<string, NextPickAvailability>([
    [estimated.id, { kind: 'estimate', probability: 0.42 as never, pickLabel: '3.04' }],
    [finalPick.id, { kind: 'no-next-pick' }],
  ]);
  const store = createDraftStore();
  act(() => { root.render(createElement(WorkspaceTestProvider, { store, children: createElement(TooltipProvider, null, createElement(DraftPlayerPool)) })); });
  expect(availabilityCell(estimated.name)?.textContent).toBe('42%');
  expect(availabilityCell(finalPick.name)?.textContent).toBe('—No later pick');
  expect(availabilityCell(unestimated.name)?.textContent).toBe('—Not estimated');
  // The catalog's static percentage for these players is not shown anywhere in their rows.
  expect(availabilityCell(finalPick.name)?.textContent).not.toContain(`${String(Math.round(finalPick.nextPickSurvivalProbability * 100))}%`);
});
