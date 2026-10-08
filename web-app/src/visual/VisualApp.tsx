import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  DRAFT_DATA_REFRESH_STEPS,
  evaluateDraftReadiness,
  type DraftDataRefreshState,
  type DraftDataRefreshStatus,
  type NFLTeam,
  type Player,
  type Position,
} from '@fantasy-draft/shared';
import { DraftHeader } from '@/components/DraftHeader';
import { MotionProvider } from '@/components/motion';
import { TooltipProvider } from '@/components/ui/tooltip';
import { NotificationProvider } from '@/components/notifications';
import { AssistantPage } from '@/features/assistant/AssistantPage';
import type { AssistantLens } from '@/features/assistant/assistant-navigation';
import { DraftBoard } from '@/features/draft-room/DraftBoard';
import { DraftReadinessBlockedNotice } from '@/features/draft-room/DraftReadinessBlockedNotice';
import { DraftWorkspace } from '@/features/draft-room/DraftWorkspace';
import { LiveDraftSyncProvider } from '@/features/draft-room/LiveDraftSyncProvider';
import { DraftSetupActionsContext, type DraftSetupActions } from '@/features/draft-room/draft-setup-actions';
import { DraftGlossary } from '@/features/help/DraftGlossary';
import {
  DraftDecisionProvider,
} from '@/features/recommendations/DraftDecisionContext';
import { RosterSettings } from '@/features/roster-settings/RosterSettings';
import { ThemeProvider } from '@/features/theme/ThemeProvider';
import {
  PlayerDataFixtureProvider,
  type PlayerDataQueryResult,
} from '@/hooks/usePlayerData';
import { createDataFreshnessItem } from '@/lib/data-freshness';
import { getTeamIndexForPick } from '@/lib/mock-draft-engine';
import {
  createDraftStore,
  DraftStoreProvider,
  type DraftStoreApi,
  type RecordedDraftPick,
} from '@/stores/draftStore';
import { createDraftSyncConnectionStore } from '@/stores/draftSyncStore';

export const VISUAL_NOW = Date.UTC(2026, 7, 27, 17, 0, 0);
export const VISUAL_TIMESTAMP = new Date(VISUAL_NOW).toISOString();
const VISUAL_SOURCE_TIMESTAMP = new Date(VISUAL_NOW - 60 * 60 * 1000).toISOString();
const VISUAL_BOARD_ROUNDS = 4;

const PLAYER_FIXTURES: readonly {
  readonly name: string;
  readonly position: Position;
  readonly team: NFLTeam;
}[] = [
  { name: 'Malik Hart', position: 'RB', team: 'ATL' },
  { name: 'Jonah Reed', position: 'WR', team: 'BUF' },
  { name: 'Eli Mercer', position: 'WR', team: 'DAL' },
  { name: 'Nico Lane', position: 'RB', team: 'DET' },
  { name: 'Theo Banks', position: 'TE', team: 'KC' },
  { name: 'Caleb Stone', position: 'QB', team: 'LAC' },
  { name: 'Andre Moss', position: 'WR', team: 'MIA' },
  { name: 'Miles Grant', position: 'RB', team: 'PHI' },
  { name: 'Owen Price', position: 'TE', team: 'SF' },
  { name: 'Drew Cole', position: 'QB', team: 'WAS' },
];

export const VISUAL_PLAYERS: readonly Player[] = PLAYER_FIXTURES.map(
  (fixture, index) => ({
    id: `visual-player-${String(index + 1)}`,
    name: fixture.name,
    position: fixture.position,
    team: fixture.team,
    byeWeek: 6 + index % 8,
    ecrRank: 47 + index,
    positionalRank: 8 + index,
    sleeperAdp: 50 + index * 1.4,
    sleeperSearchRank: 50 + index,
    consensusAdp: 51 + index * 1.2,
    valueScore: 4 - index,
    marketRank: 50 + index,
    marketAdp: 51 + index * 1.2,
    marketAdpTrend: index % 2 === 0 ? 1.5 : -0.8,
    isContractYear: index === 2 || index === 7,
    contractEndYear: 2027,
    offensiveEnvironmentScore: 8.4 - index * 0.25,
    projectedPoints: 248 - index * 8.5,
    valueOverReplacement: 64 - index * 4.5,
    tier: index < 4 ? 2 : index < 8 ? 3 : 4,
    fantasyProsTier: index < 4 ? 2 : index < 8 ? 3 : 4,
    tierSource: 'league-projection',
    tierDropoffScore: index === 3 || index === 7 ? 0.78 : 0.24,
    tierDropoffPoints: index === 3 || index === 7 ? 13.5 : 3.2,
    nextPickSurvivalProbability: Math.max(0.14, 0.76 - index * 0.06),
    nextPickNumber: 56,
    nextPickLabel: '6.6',
    picksUntilNextPick: 10,
    leagueAdjustedMarketRank: 49 + index,
    leagueMarketDelta: index % 3 === 0 ? -2 : 1,
    leaguePositionTendency: 'Primary League timing fixture',
    survivalModelSource: 'league-history',
    historicalExpectedPick: 50 + index,
    consensusMarketPick: 51 + index,
    sleeperTimingPick: 52 + index,
    survivalModelSampleSize: 70,
    ceilingScore: 276 - index * 7.5,
    floorScore: 198 - index * 6.5,
    upsideScore: 72 - index * 3,
    uncertaintyScore: 18 + index,
    injuryRiskScore: 8 + index * 1.5,
    predictionSource: 'fantasypros',
    newsStatus: 'healthy',
    stackPartnerTeam: fixture.team,
    highlightLevel: index < 2 ? 'strong-buy' : index < 5 ? 'good-value' : 'neutral',
  })
);

const READY_SOURCES = {
  'trusted-rankings': {
    availability: 'available',
    timestamp: VISUAL_SOURCE_TIMESTAMP,
    detail: 'Fixed visual ranking fixture.',
  },
  'canonical-player-identities': {
    availability: 'available',
    timestamp: VISUAL_SOURCE_TIMESTAMP,
    detail: 'Fixed visual identity fixture.',
    dependencies: [
      { key: 'trusted-rankings', label: 'Trusted rankings', timestamp: VISUAL_SOURCE_TIMESTAMP },
      { key: 'sleeper-player-directory', label: 'Sleeper player directory', timestamp: VISUAL_SOURCE_TIMESTAMP },
    ],
  },
  'primary-league-settings': {
    availability: 'available',
    timestamp: VISUAL_SOURCE_TIMESTAMP,
  },
  'confirmed-keeper-supply': {
    availability: 'available',
    timestamp: VISUAL_SOURCE_TIMESTAMP,
  },
  'experimental-predictions': {
    availability: 'available',
    timestamp: VISUAL_SOURCE_TIMESTAMP,
    detail: 'Fixed visual prediction fixture.',
    dependencies: [
      { key: 'trusted-rankings', label: 'Trusted rankings', timestamp: VISUAL_SOURCE_TIMESTAMP },
      { key: 'canonical-player-identities', label: 'Canonical player identities', timestamp: VISUAL_SOURCE_TIMESTAMP },
      { key: 'team-environment', label: 'Team environment', timestamp: VISUAL_SOURCE_TIMESTAMP },
    ],
  },
  'contract-context': {
    availability: 'available',
    timestamp: VISUAL_SOURCE_TIMESTAMP,
    detail: 'Fixed visual contract fixture.',
  },
  'sportsbook-context': {
    availability: 'available',
    timestamp: VISUAL_SOURCE_TIMESTAMP,
    detail: 'Fixed visual sportsbook fixture.',
  },
} as const;

export const VISUAL_READY_REPORT = evaluateDraftReadiness(
  { sources: READY_SOURCES },
  VISUAL_NOW
);

const VISUAL_STALE_TIMESTAMP = new Date(VISUAL_NOW - 6 * 24 * 60 * 60 * 1000).toISOString();

/** Mirrors a session started without the live preflight and connected to a Sleeper mock. */
export const VISUAL_BLOCKED_REPORT = evaluateDraftReadiness({
  sources: {
    ...READY_SOURCES,
    'trusted-rankings': {
      availability: 'available',
      timestamp: VISUAL_STALE_TIMESTAMP,
      detail: 'Fixed visual ranking fixture, intentionally stale for this capture.',
    },
    'canonical-player-identities': {
      availability: 'available',
      timestamp: VISUAL_STALE_TIMESTAMP,
      detail: 'Fixed visual identity fixture, intentionally stale for this capture.',
    },
    'primary-league-settings': {
      availability: 'missing',
      timestamp: null,
      detail: 'Connect the Primary League draft to load provider-confirmed settings.',
    },
  },
}, VISUAL_NOW);

const VISUAL_SETUP_ACTIONS: DraftSetupActions = {
  openLeagueSetup: () => undefined,
  openDraftConnection: () => undefined,
};

const VISUAL_DATA_FRESHNESS = [
  createDataFreshnessItem({
    key: 'fantasypros',
    label: 'FantasyPros rankings and projections',
    timestamp: VISUAL_SOURCE_TIMESTAMP,
    maxAgeHours: 24,
    refreshCommand: 'pnpm refresh:fantasypros',
    requiredForLiveDraft: true,
  }, VISUAL_NOW),
  createDataFreshnessItem({
    key: 'identity',
    label: 'Player identity map',
    timestamp: VISUAL_SOURCE_TIMESTAMP,
    maxAgeHours: 24,
    refreshCommand: 'pnpm data:identity',
    requiredForLiveDraft: true,
  }, VISUAL_NOW),
];

export const VISUAL_PLAYER_DATA: PlayerDataQueryResult = {
  players: [...VISUAL_PLAYERS],
  shadowPlayers: [],
  sportsbookSnapshot: undefined,
  isLoading: false,
  isError: false,
  error: null,
  dataInfo: {
    fantasyProsRefreshedAt: VISUAL_SOURCE_TIMESTAMP,
    fantasyProsSource: 'visual-fixture',
    fantasyProsSourceType: 'api',
    sleeperFetchedAt: VISUAL_SOURCE_TIMESTAMP,
    marketAdpRefreshedAt: VISUAL_SOURCE_TIMESTAMP,
    marketAdpSource: 'visual-fixture',
    marketAdpFormat: 'ppr',
    marketAdpCount: VISUAL_PLAYERS.length,
    marketAdpError: null,
    leagueSettingsFingerprint: 'visual-primary-league',
    fantasyProsCount: VISUAL_PLAYERS.length,
    sleeperCount: VISUAL_PLAYERS.length,
    sportsbookCapturedAt: VISUAL_SOURCE_TIMESTAMP,
    sportsbookIsFresh: true,
    sportsbookOverUnderCount: 0,
    sportsbookMilestoneCount: 0,
    contractsError: null,
    sportsbookError: null,
    predictionModelVersion: 'visual-fixture-v1',
    predictionGeneratedAt: VISUAL_SOURCE_TIMESTAMP,
    shadowRecommendationAvailable: false,
    recommendationFallback: 'fantasypros-ecr-market',
    recommendationPolicyReason: 'Fixed visual fixture.',
    shadowLoggingEnabled: false,
    shadowLoggingSeason: 2026,
    shadowLoggingEndpoint: '',
    predictionsError: null,
    dataFreshness: VISUAL_DATA_FRESHNESS,
    readinessSources: READY_SOURCES,
    readinessWarnings: [],
  },
};

function createFixtureHistory(): RecordedDraftPick[] {
  return Array.from({ length: 46 }, (_, index) => {
    const pickNumber = index + 1;
    const teamIndex = getTeamIndexForPick(pickNumber, 10);
    const position = (['RB', 'WR', 'QB', 'TE'] as const)[index % 4] ?? 'WR';
    return {
      pickNumber,
      playerId: `visual-drafted-${String(pickNumber)}`,
      playerName: `Drafted Player ${String(pickNumber)}`,
      position,
      teamIndex,
      teamName: teamIndex === 4 ? 'My Team' : `Team ${String(teamIndex + 1)}`,
      timestamp: VISUAL_NOW,
      source: 'sync',
    };
  });
}

export function createVisualDraftStore(): DraftStoreApi {
  const store = createDraftStore();
  const draftHistory = createFixtureHistory();
  store.setState({
    sessionMode: 'mock',
    currentPick: 47,
    draftedPlayerIds: new Set(draftHistory.map((pick) => pick.playerId)),
    draftHistory,
    shortlistedPlayerIds: ['visual-player-2', 'visual-player-6'],
    keepersInitialized: true,
    myRoster: {
      QB: ['visual-drafted-25'],
      RB: ['visual-drafted-5', 'visual-drafted-16'],
      WR: ['visual-drafted-36'],
      TE: ['visual-drafted-45'],
      K: [],
      DEF: [],
    },
  });
  return store;
}

type VisualRefreshState = Extract<DraftDataRefreshState, 'idle' | 'running' | 'failed'>;

function visualRefreshStatus(state: VisualRefreshState): DraftDataRefreshStatus {
  const startedAt = state === 'idle' ? null : new Date(VISUAL_NOW - 20_000).toISOString();
  return {
    state,
    steps: DRAFT_DATA_REFRESH_STEPS.map((step, index) => ({
      key: step.key,
      label: step.label,
      state: state === 'idle' ? 'pending' : index === 0 ? 'succeeded' : index === 1 ? state : 'pending',
    })),
    startedAt,
    finishedAt: state === 'failed' ? new Date(VISUAL_NOW).toISOString() : null,
    error: state === 'failed' ? 'FantasyPros rankings failed.' : null,
    detail: state === 'failed' ? 'Error: FantasyPros returned 503 Service Unavailable\n    at fetchRankings (scripts/src/refresh-fantasypros-snapshot.ts)' : null,
  };
}

/**
 * Answers the refresh API with a fixed status, so readiness fixtures show the refresh
 * action and its progress without reaching the local server or running a refresh.
 */
function installVisualRefreshApi(state: VisualRefreshState): void {
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (new URL(url, window.location.href).pathname !== '/api/draft-data/refresh') return realFetch(input, init);
    return Promise.resolve(Response.json(visualRefreshStatus(state)));
  };
}

export type VisualRoute =
  | { readonly screen: 'header'; readonly state: 'draft' | 'assistant' }
  | { readonly screen: 'board'; readonly state: 'mid-draft' }
  | { readonly screen: 'assistant'; readonly state: AssistantLens }
  | { readonly screen: 'mobile-draft'; readonly state: 'draft' }
  | { readonly screen: 'mobile-assistant'; readonly state: AssistantLens }
  | { readonly screen: 'readiness'; readonly state: 'blocked' | 'ready'; readonly refresh: VisualRefreshState }
  | { readonly screen: 'not-found'; readonly state: 'not-found' };

export function getVisualRoute(pathname: string, search: string): VisualRoute {
  const state = new URLSearchParams(search).get('state');
  if (pathname === '/__visual/header') {
    return { screen: 'header', state: state === 'assistant' ? 'assistant' : 'draft' };
  }
  if (pathname === '/__visual/board') {
    return { screen: 'board', state: 'mid-draft' };
  }
  if (pathname === '/__visual/assistant') {
    return {
      screen: 'assistant',
      state: state === 'compare' || state === 'roster' || state === 'why' ? state : 'wait',
    };
  }
  if (pathname === '/__visual/mobile/draft') {
    return { screen: 'mobile-draft', state: 'draft' };
  }
  if (pathname === '/__visual/mobile/assistant') {
    return {
      screen: 'mobile-assistant',
      state: state === 'compare' || state === 'roster' || state === 'why' ? state : 'wait',
    };
  }
  if (pathname === '/__visual/readiness') {
    const refresh = new URLSearchParams(search).get('refresh');
    return {
      screen: 'readiness',
      state: state === 'ready' ? 'ready' : 'blocked',
      refresh: refresh === 'running' || refresh === 'failed' ? refresh : 'idle',
    };
  }
  return { screen: 'not-found', state: 'not-found' };
}

function Header({ route }: { readonly route: 'draft' | 'assistant' }): React.ReactElement {
  return (
    <DraftHeader
      route={route}
      onNavigate={() => undefined}
      secondaryControls={(
        <>
          <DraftGlossary />
          <RosterSettings />
        </>
      )}
    />
  );
}

function DraftWorkspaceFixture(): React.ReactElement {
  return (
    <>
      <Header route="draft" />
      <DraftWorkspace roundWindowSize={VISUAL_BOARD_ROUNDS} onOpenAssistant={() => undefined} />
    </>
  );
}

function AssistantFixture({ lens }: { readonly lens: AssistantLens }): React.ReactElement {
  return (
    <>
      <Header route="assistant" />
      <AssistantPage
        initialLens={lens}
        initialSelectedPlayerId={VISUAL_PLAYERS[0]?.id ?? null}
        onReturnToDraft={() => undefined}
      />
    </>
  );
}

function VisualRouteContent({ route }: { readonly route: VisualRoute }): React.ReactElement {
  switch (route.screen) {
    case 'header':
      return <Header route={route.state} />;
    case 'board':
      return (
        <main className="w-full p-4">
          <DraftBoard roundWindowSize={VISUAL_BOARD_ROUNDS} />
        </main>
      );
    case 'assistant':
    case 'mobile-assistant':
      return <AssistantFixture lens={route.state} />;
    case 'mobile-draft':
      return <DraftWorkspaceFixture />;
    case 'readiness': {
      const report = route.state === 'blocked'
        ? VISUAL_BLOCKED_REPORT
        : VISUAL_READY_REPORT;
      return (
        <main className="mx-auto w-full max-w-4xl p-4">
          <DraftSetupActionsContext.Provider value={VISUAL_SETUP_ACTIONS}>
            <DraftReadinessBlockedNotice readiness={report} />
          </DraftSetupActionsContext.Provider>
        </main>
      );
    }
    case 'not-found':
      return <main className="p-4">Visual fixture not found.</main>;
  }
}

function VisualReadySignal(): null {
  React.useEffect(() => {
    let cancelled = false;
    let readyTimeout: number | null = null;
    const markReady = (): void => {
      readyTimeout = window.setTimeout(() => {
        if (cancelled) return;
        window.__VISUAL_READY__ = true;
        document.documentElement.setAttribute('data-visual-ready', '');
      }, 0);
    };

    if (document.fonts) {
      void document.fonts.ready.then(markReady);
    } else {
      markReady();
    }

    return () => {
      cancelled = true;
      if (readyTimeout !== null) window.clearTimeout(readyTimeout);
      window.__VISUAL_READY__ = false;
      document.documentElement.removeAttribute('data-visual-ready');
    };
  }, []);
  return null;
}

export function VisualApp(): React.ReactElement {
  const [draftStore] = React.useState(createVisualDraftStore);
  // A persisted live draft must not reach useDraftSync or switch the mock fixture store to live.
  const [connectionStore] = React.useState(() => createDraftSyncConnectionStore({
    initialConnection: null,
    persist: () => undefined,
  }));
  const route = React.useMemo(
    () => getVisualRoute(window.location.pathname, window.location.search),
    []
  );
  React.useState(() => { installVisualRefreshApi(route.screen === 'readiness' ? route.refresh : 'idle'); });
  const [queryClient] = React.useState(() => {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Infinity,
        },
      },
    });
    client.setQueryData(['league-survival-model', 'primary-league'], null, { updatedAt: VISUAL_NOW });
    return client;
  });

  return (
    <ThemeProvider initialTheme="light" persist={false}>
      <QueryClientProvider client={queryClient}>
        <DraftStoreProvider store={draftStore}>
          <PlayerDataFixtureProvider value={VISUAL_PLAYER_DATA}>
            <NotificationProvider>
              <TooltipProvider><MotionProvider>
                <LiveDraftSyncProvider connectionStore={connectionStore}>
                  <DraftDecisionProvider readiness={VISUAL_READY_REPORT}>
                    <div className="min-h-screen bg-background text-foreground" data-visual-screen={route.screen}>
                      <VisualRouteContent route={route} />
                    </div>
                    <VisualReadySignal />
                  </DraftDecisionProvider>
                </LiveDraftSyncProvider>
              </MotionProvider></TooltipProvider>
            </NotificationProvider>
          </PlayerDataFixtureProvider>
        </DraftStoreProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
