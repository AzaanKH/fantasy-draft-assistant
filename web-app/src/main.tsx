import { StrictMode, type ReactElement } from 'react';
import { STORAGE_ACTIVATION_ENABLED } from '@fantasy-draft/shared/sync';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionProvider } from './components/motion';
import { TooltipProvider } from './components/ui/tooltip';
import { NotificationProvider } from './components/notifications';
import { ThemeProvider } from './features/theme/ThemeProvider';
import { applyTheme, readStoredTheme } from './features/theme/theme';
import { LivePlayerDataProvider } from './hooks/usePlayerData';
import { createBrowserWorkspace } from './workspace/browser-workspace';
import { WorkspaceProvider } from './workspace/WorkspaceProvider';
import { CommandNotice } from './workspace/CommandNotice';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

const root = createRoot(rootElement);
const visualRouteRequested = window.location.pathname.startsWith('/__visual/');

function renderNormalApp(app: ReactElement, harnessFactory?: () => import('./workspace/workspace').Workspace): void {
  const workspace = createBrowserWorkspace(window.location.search, harnessFactory);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        retry: 2,
      },
    },
  });

  root.render(
    <StrictMode>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <WorkspaceProvider workspace={workspace}>
            <LivePlayerDataProvider>
              <NotificationProvider>
                <TooltipProvider><MotionProvider><CommandNotice />{app}</MotionProvider></TooltipProvider>
              </NotificationProvider>
            </LivePlayerDataProvider>
          </WorkspaceProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </StrictMode>
  );
}

if (import.meta.env.DEV && visualRouteRequested) {
  document.documentElement.setAttribute('data-visual-test', '');
  document.documentElement.removeAttribute('data-visual-ready');
  window.__VISUAL_READY__ = false;
  void import('./visual/VisualApp').then(({ VisualApp }) => {
    root.render(
      <StrictMode>
        <VisualApp />
      </StrictMode>
    );
  });
} else if (visualRouteRequested) {
  root.render(<main>Not found</main>);
} else if ((STORAGE_ACTIVATION_ENABLED || (import.meta.env.DEV && import.meta.env.VITE_PERSISTENCE_HARNESS === 'idb')) && new URLSearchParams(location.search).has('__storageProbe')) {
  void import('./workspace/storage-sharing').then(({ serveStorageProbe }) => serveStorageProbe(new URLSearchParams(location.search).get('__storageProbe') ?? '', { canonicalOrigin: String(import.meta.env.VITE_CANONICAL_WEB_ORIGIN) })).catch((error: unknown) => { root.render(<main role="alert">{String(error)}</main>); });
} else {
  void import('./App').then(async ({ App }) => {
    applyTheme(readStoredTheme());
    if (STORAGE_ACTIVATION_ENABLED) {
      const { verifyStorageSharing } = await import('./workspace/storage-sharing');
      const verified = await verifyStorageSharing({ canonicalOrigin: String(import.meta.env.VITE_CANONICAL_WEB_ORIGIN), location: window.location });
      const { showStorageActivation } = await import('./workspace/activation-entry');
      showStorageActivation({ root, verified, ready: workspace => { renderNormalApp(<App />, () => workspace); } });
      return;
    }
    let harnessFactory: (() => import('./workspace/workspace').Workspace) | undefined;
    if (import.meta.env.DEV && import.meta.env.VITE_PERSISTENCE_HARNESS === 'idb') {
      const { verifyStorageSharing } = await import('./workspace/storage-sharing');
      const verified = await verifyStorageSharing({ canonicalOrigin: String(import.meta.env.VITE_CANONICAL_WEB_ORIGIN), location: window.location });
      const { createHarnessWorkspace } = await import('./workspace/harness-workspace');
      harnessFactory = () => createHarnessWorkspace(verified);
    }
    renderNormalApp(<App />, harnessFactory);
  }).catch((error: unknown) => {
    root.render(
      <main role="alert" data-storage-blocked={STORAGE_ACTIVATION_ENABLED || (import.meta.env.DEV && import.meta.env.VITE_PERSISTENCE_HARNESS === 'idb') ? String(error) : undefined}>Unable to load the draft app. {STORAGE_ACTIVATION_ENABLED ? String(error) : 'Please reload the page.'}</main>
    );
  });
}
