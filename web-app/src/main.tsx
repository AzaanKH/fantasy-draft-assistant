import { StrictMode, type ReactElement } from 'react';
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
                <TooltipProvider><MotionProvider>{app}</MotionProvider></TooltipProvider>
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
} else if (import.meta.env.DEV && import.meta.env.VITE_PERSISTENCE_HARNESS === 'idb' && new URLSearchParams(location.search).has('__storageProbe')) {
  void import('./workspace/storage-sharing').then(({ serveStorageProbe }) => serveStorageProbe(new URLSearchParams(location.search).get('__storageProbe') ?? '', { canonicalOrigin: String(import.meta.env.VITE_CANONICAL_WEB_ORIGIN) })).catch((error: unknown) => { root.render(<main role="alert">{String(error)}</main>); });
} else {
  void import('./App').then(async ({ App }) => {
    applyTheme(readStoredTheme());
    if (import.meta.env.DEV && import.meta.env.VITE_PERSISTENCE_HARNESS === 'idb') {
      const { verifyStorageSharing } = await import('./workspace/storage-sharing');
      await verifyStorageSharing({ canonicalOrigin: String(import.meta.env.VITE_CANONICAL_WEB_ORIGIN), location: window.location });
    }
    const harnessFactory = import.meta.env.DEV && import.meta.env.VITE_PERSISTENCE_HARNESS === 'idb'
      ? (await import('./workspace/harness-workspace')).createHarnessWorkspace : undefined;
    renderNormalApp(<App />, harnessFactory);
  }).catch((error: unknown) => {
    root.render(
      <main role="alert" data-storage-blocked={import.meta.env.DEV && import.meta.env.VITE_PERSISTENCE_HARNESS === 'idb' ? String(error) : undefined}>Unable to load the draft app. Please reload the page.</main>
    );
  });
}
