import { StrictMode, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionProvider } from './components/motion';
import { UndoToastProvider } from './components/undo-toast';
import { ThemeProvider } from './features/theme/ThemeProvider';
import { applyTheme, readStoredTheme } from './features/theme/theme';
import { LivePlayerDataProvider } from './hooks/usePlayerData';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

const root = createRoot(rootElement);
const visualRouteRequested = window.location.pathname.startsWith('/__visual/');

function renderNormalApp(app: ReactElement): void {
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
          <LivePlayerDataProvider>
            <UndoToastProvider>
              <MotionProvider>{app}</MotionProvider>
            </UndoToastProvider>
          </LivePlayerDataProvider>
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
} else {
  void Promise.all([
    import('./App'),
    import('./stores/draftSyncStore'),
  ]).then(([{ App }, { initializeDraftSyncConnection }]) => {
    applyTheme(readStoredTheme());
    initializeDraftSyncConnection(window.location.search);
    renderNormalApp(<App />);
  });
}
