import { createDefaultLeagueSettings } from '@fantasy-draft/shared';
import { createQuickMockSettings } from '@/lib/quick-mock-settings';
import { useLeagueSetupStore } from '@/stores/leagueSetupStore';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { DraftHeader } from '@/components/DraftHeader';
import { RouteErrorBoundary } from '@/components/RouteErrorBoundary';
import { RouteSkeleton } from '@/components/skeletons';
import {
  DEFAULT_ASSISTANT_NAVIGATION_TARGET,
  getAssistantNavigationTarget,
  type AssistantNavigationTarget,
} from '@/features/assistant/assistant-navigation';
import { DraftRoom } from '@/features/draft-room/DraftRoom';
import { LiveDraftSyncProvider } from '@/features/draft-room/LiveDraftSyncProvider';
import { MockDraftAutoAdvance } from '@/features/draft-board/mock-auto-advance';
import { ShadowRecommendationObserver } from '@/features/draft-room/ShadowRecommendationObserver';
import { DraftDecisionProvider } from '@/features/recommendations/DraftDecisionContext';
import { useKeeperPreload } from '@/hooks/useKeeperPreload';
import { usePlayerDataQuery } from '@/hooks/usePlayerData';
import { getAppHref, getAppRoute, type AppRoute } from '@/lib/app-route';
import { evaluateWorkspaceDraftReadiness } from '@/lib/draft-readiness';
import { IS_DEMO, RANKING_LABELS } from '@/lib/demo-mode';
import { useDraftStore } from '@/stores/draftStore';
import { useDraftSyncConnectionStore } from '@/stores/draftSyncStore';
import { DraftConnectionControl } from '@/features/draft-room/DraftConnectionControl';
import { DraftSetupActionsContext, type DraftSetupActions } from '@/features/draft-room/draft-setup-actions';

const LeagueSetupDialog = React.lazy(() => import('@/features/league-setup/LeagueSetupDialog').then((module) => ({ default: module.LeagueSetupDialog })));

const DraftGlossary = React.lazy(() =>
  import('@/features/help/DraftGlossary').then((module) => ({
    default: module.DraftGlossary,
  }))
);

const RosterSettings = React.lazy(() =>
  import('@/features/roster-settings/RosterSettings').then((module) => ({
    default: module.RosterSettings,
  }))
);

const AssistantPage = React.lazy(() =>
  import('@/features/assistant/AssistantPage').then((module) => ({
    default: module.AssistantPage,
  }))
);

const SidePanelPage = React.lazy(() =>
  import('@/features/sidepanel/SidePanelPage').then((module) => ({
    default: module.SidePanelPage,
  }))
);

function RouteLoading({ route }: { readonly route: AppRoute }): React.ReactElement {
  return <RouteSkeleton route={route} />;
}

export function App(): React.ReactElement {
  const [leagueSetupOpen, setLeagueSetupOpen] = React.useState(false);
  // Load on first open, then stay mounted so the dialog can animate closed.
  const [leagueSetupLoaded, setLeagueSetupLoaded] = React.useState(false);
  if (leagueSetupOpen && !leagueSetupLoaded) setLeagueSetupLoaded(true);
  const [connectionDialogOpen, setConnectionDialogOpen] = React.useState(false);
  const setupActions = React.useMemo<DraftSetupActions>(() => ({
    openLeagueSetup: () => { setLeagueSetupOpen(true); },
    ...(IS_DEMO ? {} : { openDraftConnection: () => { setConnectionDialogOpen(true); } }),
  }), []);
  const [route, setRoute] = React.useState<AppRoute>(() => getAppRoute(window.location.pathname));
  const [assistantNavigationTarget, setAssistantNavigationTarget] =
    React.useState<AssistantNavigationTarget>(() =>
      getAppRoute(window.location.pathname) === 'assistant'
        ? getAssistantNavigationTarget(window.history.state)
        : DEFAULT_ASSISTANT_NAVIGATION_TARGET
    );
  const { players, isLoading, dataInfo } = usePlayerDataQuery();
  const keeperStatus = useKeeperPreload(players, isLoading);
  const localProfile = useLeagueSetupStore((state) => state.profile);
  const quickMockPreferences = useLeagueSetupStore((state) => state.quickMock);
  const connection = useDraftSyncConnectionStore((state) => state.connection);
  const sessionMode = useDraftStore((state) => state.sessionMode);
  const applyLeagueSettings = useDraftStore((state) => state.applyLeagueSettings);
  const setConfig = useDraftStore((state) => state.setConfig);
  const hasPicks = useDraftStore((state) => state.draftHistory.some((pick) => pick.source !== 'keeper'));
  const useQuickMockSettings = connection ? connection.settingsProfile === 'quick-mock' : localProfile === 'quick-mock';
  React.useEffect(() => {
    if (connection || sessionMode !== 'setup' || hasPicks) return;
    applyLeagueSettings(localProfile === 'quick-mock' ? createQuickMockSettings(quickMockPreferences) : createDefaultLeagueSettings());
    setConfig(localProfile === 'quick-mock' ? { totalTeams: quickMockPreferences.totalTeams, totalRounds: quickMockPreferences.totalRounds } : { totalTeams: 10, totalRounds: 14 });
  }, [connection, sessionMode, hasPicks, localProfile, quickMockPreferences, applyLeagueSettings, setConfig]);
  const leagueSettings = useDraftStore((state) => state.leagueSettings);
  const usePrimaryLeagueSettings = connection ? connection.provider === 'sleeper' && connection.usePrimaryLeagueSettings === true : localProfile === 'primary-league';
  const totalRounds = useDraftStore((state) => state.config.totalRounds);
  const [readinessNow, setReadinessNow] = React.useState(() => Date.now());
  const readiness = React.useMemo(() => evaluateWorkspaceDraftReadiness({
    sources: dataInfo.readinessSources,
    warnings: dataInfo.readinessWarnings,
    leagueSettings,
    totalRounds,
    keeperStatus,
    usePrimaryLeagueSettings,
    useQuickMockSettings,
    demo: IS_DEMO,
    demoRankingsSource: `Demo rankings (${RANKING_LABELS.source})`,
  }, readinessNow), [
    dataInfo.readinessSources,
    dataInfo.readinessWarnings,
    keeperStatus,
    leagueSettings,
    readinessNow,
    totalRounds,
    usePrimaryLeagueSettings,
    useQuickMockSettings,
  ]);

  React.useEffect(() => {
    const interval = window.setInterval(() => { setReadinessNow(Date.now()); }, 60_000);
    return () => { window.clearInterval(interval); };
  }, []);

  React.useEffect(() => {
    if (window.location.pathname === '/') {
      window.history.replaceState(
        null,
        '',
        getAppHref('draft', window.location.search, window.location.hash)
      );
    }
    const handlePopState = (event: PopStateEvent): void => {
      React.startTransition(() => {
        const nextRoute = getAppRoute(window.location.pathname);
        setRoute(nextRoute);
        setAssistantNavigationTarget(
          nextRoute === 'assistant'
            ? getAssistantNavigationTarget(event.state)
            : DEFAULT_ASSISTANT_NAVIGATION_TARGET
        );
      });
    };
    window.addEventListener('popstate', handlePopState);
    return () => { window.removeEventListener('popstate', handlePopState); };
  }, []);

  const navigate = React.useCallback((
    nextRoute: AppRoute,
    nextAssistantTarget: AssistantNavigationTarget = DEFAULT_ASSISTANT_NAVIGATION_TARGET
  ): void => {
    const historyState = nextRoute === 'assistant' ? nextAssistantTarget : null;
    if (getAppRoute(window.location.pathname) !== nextRoute) {
      window.history.pushState(
        historyState,
        '',
        getAppHref(nextRoute, window.location.search, window.location.hash)
      );
    }
    React.startTransition(() => {
      setRoute(nextRoute);
      setAssistantNavigationTarget(
        nextRoute === 'assistant'
          ? nextAssistantTarget
          : DEFAULT_ASSISTANT_NAVIGATION_TARGET
      );
    });
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  if (route === 'sidepanel') {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <DraftDecisionProvider readiness={readiness}>
          <RouteErrorBoundary>
            <React.Suspense fallback={<RouteLoading route="sidepanel" />}>
              <SidePanelPage />
            </React.Suspense>
          </RouteErrorBoundary>
        </DraftDecisionProvider>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <LiveDraftSyncProvider>
        <DraftDecisionProvider readiness={readiness}>
          <DraftSetupActionsContext.Provider value={setupActions}>
            {/* Catches the lazy header controls and setup dialog; the sync provider above stays mounted. */}
            <RouteErrorBoundary>
              <DraftHeader
                route={route}
                onNavigate={navigate}
                connectionControl={IS_DEMO ? undefined : <DraftConnectionControl readiness={readiness} open={connectionDialogOpen} onOpenChange={setConnectionDialogOpen} />}
                keeperStatus={keeperStatus}
                onManageLeagueSettings={() => { setLeagueSetupOpen(true); }}
                secondaryControls={(
                  <React.Suspense fallback={<Button variant="outline" size="sm" disabled aria-label="Loading draft controls" />}>
                    <DraftGlossary />
                    <RosterSettings />
                  </React.Suspense>
                )}
              />
              {leagueSetupLoaded ? <React.Suspense fallback={null}>
                <LeagueSetupDialog open={leagueSetupOpen} onOpenChange={setLeagueSetupOpen} onConnectPrimary={() => { setConnectionDialogOpen(true); }} />
              </React.Suspense> : null}
              <ShadowRecommendationObserver />
              <MockDraftAutoAdvance />
              <RouteErrorBoundary key={route} onReturnToBoard={route === 'draft' ? undefined : () => { navigate('draft'); }}>
                <React.Suspense fallback={<RouteLoading route={route} />}>
                  {route === 'assistant' ? (
                    <AssistantPage
                      key={`${assistantNavigationTarget.lens}:${assistantNavigationTarget.selectedPlayerId ?? 'none'}`}
                      initialLens={assistantNavigationTarget.lens}
                      initialSelectedPlayerId={assistantNavigationTarget.selectedPlayerId}
                      onReturnToDraft={() => { navigate('draft'); }}
                    />
                  ) : (
                    <DraftRoom
                      keeperStatus={keeperStatus}
                      onOpenAssistant={(target) => { navigate('assistant', target); }}
                    />
                  )}
                </React.Suspense>
              </RouteErrorBoundary>
            </RouteErrorBoundary>
          </DraftSetupActionsContext.Provider>
        </DraftDecisionProvider>
      </LiveDraftSyncProvider>
    </div>
  );
}
