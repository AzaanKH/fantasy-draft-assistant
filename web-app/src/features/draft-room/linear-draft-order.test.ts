// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Player } from '@fantasy-draft/shared/league';
import type { Recommendation } from '@fantasy-draft/shared/draft';
import type { DraftType } from '@fantasy-draft/shared/sync';
import { useDraftPlayerAction } from '@/hooks/useDraftPlayerAction';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SidePanelPage } from '@/features/sidepanel/SidePanelPage';
import { ThemeProvider } from '@/features/theme/ThemeProvider';
import { createDraftStore, DraftStoreProvider, type DraftStoreApi } from '@/stores/draftStore';
import { DraftDecisionBar } from './DraftDecisionBar';
import { ProvisionalPickDialog } from './ProvisionalPickDialog';

const player: Player = {
  id: 'observed-receiver', name: 'Observed Receiver', position: 'WR', team: 'BUF',
  byeWeek: 8, ecrRank: 1, positionalRank: 1, sleeperAdp: 1, valueScore: 0,
  marketRank: 1, marketAdp: 1, marketAdpTrend: 0, isContractYear: false,
  offensiveEnvironmentScore: 7, projectedPoints: 240, valueOverReplacement: 50,
  tier: 1, tierDropoffScore: 0, nextPickSurvivalProbability: 0.5,
  ceilingScore: 0, floorScore: 0, upsideScore: 0, uncertaintyScore: 0,
  injuryRiskScore: 0, predictionSource: 'heuristic', newsStatus: 'healthy',
  stackPartnerTeam: 'BUF', highlightLevel: 'neutral',
};
const recommendation: Recommendation = {
  playerId: player.id, playerName: player.name, position: player.position,
  reason: 'Strong receiver', score: 1,
};

const catalog = [player];
vi.mock('@/hooks/usePlayerData', () => ({
  usePlayerDataQuery: () => ({ players: catalog, isLoading: false, isError: false }),
}));
vi.mock('@/features/recommendations/DraftDecisionContext', () => ({
  useDraftDecision: () => ({
    isLoading: false,
    recommendationsBlocked: false,
    recommendationsBlockedByProviderIdentity: false,
    output: { bestPick: recommendation },
    overall: {
      recommendations: [], preferred: null, rankByPlayerId: new Map(),
      explanationByPlayerId: new Map(), selection: { policy: 'ecr-anchor' },
    },
  }),
}));
vi.mock('@/hooks/useTeamNeeds', () => ({ useTeamNeeds: () => ({ needs: [] }) }));
vi.mock('@/hooks/useQueueActions', () => ({
  useQueueActions: () => ({ togglePlayerQueued: vi.fn() }),
}));
vi.mock('./LiveDraftSyncProvider', () => ({
  useLiveDraftSync: () => ({ connection: { provider: 'espn' } }),
}));
vi.mock('@/hooks/useDraftSync', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/hooks/useDraftSync')>(),
  useDraftSync: () => ({
    draft: null, synchronizationState: 'manual-continuity',
    lastSyncAgeMs: 1000, lastSuccessfulSyncAt: 1000, lastError: null,
  }),
}));

let container: HTMLDivElement;
let root: Root;
let store: DraftStoreApi;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  store = createDraftStore();
  store.getState().setConfig({
    totalTeams: 4, totalRounds: 3, myPickPosition: 2, draftType: 'linear',
  });
  store.getState().setSessionMode('live');
  store.setState({ currentPick: 5, draftProgress: { anchor: { kind: 'carry', pickNumber: 5 }, historyLength: 0 } });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function render(element: ReactElement): void {
  act(() => {
    root.render(createElement(DraftStoreProvider, {
      store,
      children: createElement(ThemeProvider, {
        initialTheme: 'light', persist: false,
        children: createElement(TooltipProvider, null, element),
      }),
    }));
  });
}

function renderDialog(onOpenChange = vi.fn()): void {
  render(createElement(ProvisionalPickDialog, { open: true, onOpenChange }));
}

function slotSelect(): HTMLSelectElement {
  const select = document.querySelector<HTMLSelectElement>('select[aria-label="Team and draft position"]');
  if (!select) throw new Error('Draft-position select was not rendered');
  return select;
}

function recordPick(): void {
  const button = [...document.querySelectorAll('button')].find((candidate) =>
    candidate.textContent === 'Record Provisional Pick');
  if (!button) throw new Error('Record Provisional Pick button was not rendered');
  act(() => { button.click(); });
}

describe('ProvisionalPickDialog linear order', () => {
  it('labels an even-round pick with its linear team', () => {
    renderDialog();
    expect(slotSelect().selectedOptions[0]?.textContent).toBe('Pick 2.01 · #5 · Team 1');
  });

  it('records an even-round pick through the store for the linear team', () => {
    const onOpenChange = vi.fn();
    renderDialog(onOpenChange);
    recordPick();
    expect(store.getState().draftHistory).toEqual([
      expect.objectContaining({
        pickNumber: 5, playerId: player.id, teamIndex: 0,
        teamName: 'Team 1', source: 'provisional',
      }),
    ]);
    expect(store.getState().teamRosters[0]?.WR).toContain(player.id);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it.each([
    { draftType: 'linear', occupied: '6', available: '7' },
    { draftType: 'snake', occupied: '7', available: '6' },
  ] satisfies readonly { draftType: DraftType; occupied: string; available: string }[])(
    'excludes the even-round keeper slot for $draftType drafts',
    ({ draftType, occupied, available }) => {
      store.getState().setConfig({ draftType });
      store.getState().preloadKeepers([{
        playerId: 'keeper', playerName: 'Keeper Receiver', position: 'WR',
        teamIndex: 1, round: 2, isMyKeeper: true,
      }]);
      renderDialog();
      const options = [...slotSelect().options].map((option) => option.value);
      expect(options).not.toContain(occupied);
      expect(options).toContain(available);
    }
  );
});

describe('rendered linear turn timing', () => {
  it.each([
    { currentPick: 5, expected: '1 picks away' },
    { currentPick: 6, expected: 'Your turn' },
  ])('shows decision-bar timing at linear pick $currentPick', ({ currentPick, expected }) => {
    store.setState({ currentPick, draftProgress: { anchor: { kind: 'carry', pickNumber: currentPick }, historyLength: 0 } });
    render(createElement(DraftDecisionBar, { onOpenAssistant: vi.fn() }));
    expect(container.textContent).toContain(expected);
  });

  it.each([
    { currentPick: 5, expected: 'Your pick in 1' },
    { currentPick: 6, expected: 'Your pick now' },
    { currentPick: 13, expected: 'Draft complete' },
  ])('shows side-panel timing at linear pick $currentPick', ({ currentPick, expected }) => {
    store.setState({ currentPick, draftProgress: { anchor: { kind: 'carry', pickNumber: currentPick }, historyLength: 0 } });
    render(createElement(SidePanelPage));
    expect(container.textContent).toContain(expected);
  });
});


describe('legacy auction presentation', () => {
  it('records a nominal even-round auction slot using legacy snake order', () => {
    store.getState().setConfig({ draftType: 'auction' });
    renderDialog();
    expect(slotSelect().selectedOptions[0]?.textContent).toBe('Pick 2.01 · #5 · Team 4');
    recordPick();
    expect(store.getState().draftHistory[0]).toMatchObject({ pickNumber: 5, teamIndex: 3 });
  });

  it('keeps the decision bar and Companion on nominal snake timing for auctions', () => {
    store.getState().setConfig({ draftType: 'auction' });
    render(createElement('div', null,
      createElement(DraftDecisionBar, { onOpenAssistant: vi.fn() }), createElement(SidePanelPage)));
    expect(container.textContent).toContain('2 picks away');
    expect(container.textContent).toContain('Your pick in 2');
  });
});


function DraftActionProbe(): ReactElement {
  const { canDraft, draftPlayer } = useDraftPlayerAction();
  return createElement('button', { disabled: !canDraft, onClick: () => { draftPlayer(player); } }, 'Draft probe');
}

describe('completed mock draft actions', () => {
  it.each(['snake', 'linear'] as const)('does not offer a phantom %s turn after the final round', draftType => {
    store.getState().setConfig({ draftType, myPickPosition: draftType === 'linear' ? 1 : 4 });
    store.getState().setSessionMode('mock');
    store.setState({ currentPick: 13, draftProgress: { anchor: { kind: 'carry', pickNumber: 13 }, historyLength: 0 } });
    render(createElement(DraftActionProbe));
    const button = container.querySelector('button');
    expect(button?.disabled).toBe(true);
    act(() => { button?.click(); });
    expect(store.getState().draftHistory).toEqual([]);
    expect(store.getState().myRoster.WR).toEqual([]);
  });
});
