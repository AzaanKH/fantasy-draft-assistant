// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POSITIONS, type Position } from '@fantasy-draft/shared/league';
import type { DraftDecisionView } from '@fantasy-draft/shared/draft';
import { TooltipProvider } from '@/components/ui/tooltip';
import { createDraftStore } from '@/stores/draftStore';
import { VISUAL_BLOCKED_REPORT, VISUAL_PLAYERS } from '@/visual/VisualApp';
import { WorkspaceTestProvider } from '@/workspace/workspace-test-helpers';
import { DraftRoom } from './DraftRoom';
import { DraftSetupActionsContext } from './draft-setup-actions';

const state = vi.hoisted(() => ({ isLoading: true, blocked: true }));
const emptyView = { recommendations: [], preferred: null, rankByPlayerId: new Map(), explanationByPlayerId: new Map(), selection: {} } as unknown as DraftDecisionView;

vi.mock('@/hooks/usePlayerData', () => ({
  usePlayerDataQuery: () => ({ players: state.isLoading ? [] : VISUAL_PLAYERS, isLoading: state.isLoading }),
}));
vi.mock('@/features/draft-board/MockDraftControls', () => ({ MockDraftControls: () => null }));
vi.mock('@/features/draft-room/LiveDraftSyncProvider', () => ({ useLiveDraftSync: () => ({ sync: {}, connection: null }) }));
vi.mock('@/hooks/useDraftDataRefresh', () => ({ useDraftDataRefresh: () => ({ status: null, isStarting: false, isAvailable: false, start: vi.fn() }) }));
vi.mock('@/features/recommendations/DraftDecisionContext', () => ({
  useDraftDecision: () => ({
    isLoading: false,
    recommendationsBlocked: state.blocked,
    recommendationsBlockedByProviderIdentity: false,
    readiness: VISUAL_BLOCKED_REPORT,
    output: { bestPick: null, selectedLens: 'best-pick' },
    overall: emptyView,
    byPosition: Object.fromEntries(POSITIONS.map((position) => [position, emptyView])) as Record<Position, DraftDecisionView>,
  }),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
  }));
  vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

function render(): void {
  act(() => {
    root.render(createElement(WorkspaceTestProvider, { store: createDraftStore(), children:
      createElement(DraftSetupActionsContext.Provider, { value: { openLeagueSetup: vi.fn() } },
        createElement(TooltipProvider, null,
          createElement(DraftRoom, { keeperStatus: { isMockReady: true } as never, onOpenAssistant: vi.fn() }))) }));
  });
}

/** The workspace rows above the player workspace: what an arriving notice would push down. */
function rowsAboveDock(): string[] {
  const stack = container.querySelector('.draft-workspace-stack');
  const main = container.querySelector('main.draft-workspace');
  const visible = (node: Element): boolean => !node.classList.contains('sr-only');
  return [
    ...[...(main?.children ?? [])].filter(visible).map((node) => node.className),
    ...[...(stack?.children ?? [])].filter(visible).map((node) => node.className),
  ];
}

describe('readiness checklist placement', () => {
  it('adds nothing above the dock when blocked readiness arrives with the data', () => {
    state.isLoading = true;
    state.blocked = true;
    render();
    const loading = rowsAboveDock();
    expect(container.querySelector('.draft-setup-checklist')).toBeNull();

    state.isLoading = false;
    render();
    expect(rowsAboveDock()).toEqual(loading);
    const checklist = container.querySelector('.draft-dock > .draft-dock-checklist > .draft-setup-checklist');
    expect(checklist?.textContent).toContain('Finish setup to turn on recommendations');
    expect(container.querySelector('.draft-best-pick-inline')?.textContent).toContain('See the setup checklist below');
  });

  it('reserves no space when readiness passes', () => {
    state.isLoading = false;
    state.blocked = false;
    render();
    expect(container.querySelector('.draft-dock-checklist')).toBeNull();
  });
});
