// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { POSITIONS, type Position } from '@fantasy-draft/shared/league';
import type { DraftDecisionView } from '@fantasy-draft/shared/draft';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ThemeProvider } from '@/features/theme/ThemeProvider';
import { createDraftStore } from '@/stores/draftStore';
import { WorkspaceTestProvider } from '@/workspace/workspace-test-helpers';
import { SidePanelPage } from './SidePanelPage';
import { SidePanelSkeleton } from './SidePanelFrame';

const state = vi.hoisted(() => ({ isLoading: true }));
const emptyView = { recommendations: [], preferred: null, rankByPlayerId: new Map(), explanationByPlayerId: new Map(), selection: {} } as unknown as DraftDecisionView;

vi.mock('@/hooks/usePlayerData', () => ({ usePlayerDataQuery: () => ({ players: [], isLoading: state.isLoading, isError: false }) }));
vi.mock('@/hooks/useTeamNeeds', () => ({ useTeamNeeds: () => ({ needs: [] }) }));
vi.mock('@/hooks/useDraftSync', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/hooks/useDraftSync')>(),
  useDraftSync: () => ({ synchronizationState: 'confirmed', lastSuccessfulSyncAt: null, lastError: null }),
}));
vi.mock('@/features/recommendations/DraftDecisionContext', () => ({
  useDraftDecision: () => ({
    isLoading: false,
    recommendationsBlocked: false,
    recommendationsBlockedByProviderIdentity: false,
    unresolvedProviderPicks: [],
    readiness: null,
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
  vi.stubGlobal('scrollTo', vi.fn());
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

function render(element: React.ReactElement): void {
  act(() => {
    root.render(createElement(WorkspaceTestProvider, { store: createDraftStore(), children: createElement(ThemeProvider, { initialTheme: 'light', persist: false, children: createElement(TooltipProvider, null, element) }) }));
  });
}

/** The frame, header, filters and navigation, which loaded and loading panels share. */
function frame(): string[] {
  const isFrame = (node: Element): boolean => ['HEADER', 'MAIN', 'NAV'].includes(node.tagName) ||
    (node.tagName === 'DIV' && node.classList.contains('max-w-[520px]')) ||
    node.getAttribute('aria-label') === 'Filter recommendations by position';
  return [...container.querySelectorAll('*')].filter(isFrame).map((node) => `${node.tagName.toLowerCase()} ${node.className}`);
}

it('shows the side panel loading state while player data loads', () => {
  state.isLoading = true;
  render(createElement(SidePanelPage));
  const page = container.innerHTML;
  render(createElement(SidePanelSkeleton));
  expect(page).toContain(container.innerHTML);
});

it('renders the same frame loading and loaded', () => {
  state.isLoading = false;
  render(createElement(SidePanelPage));
  const loaded = frame();
  expect(loaded).toHaveLength(5);
  render(createElement(SidePanelSkeleton));
  expect(frame()).toEqual(loaded);
});
