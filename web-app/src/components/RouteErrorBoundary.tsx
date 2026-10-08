import * as React from 'react';
import { CircleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface RouteErrorBoundaryProps {
  readonly children: React.ReactNode;
  /** Shown when the failed page is not the board, so the manager can get back to it. */
  readonly onReturnToBoard?: () => void;
}

/** Chrome, Firefox, and Safari wording for a page module that failed to download. */
const IMPORT_FAILURE = /dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

/**
 * Browsers keep a module that failed to download as failed for the rest of the page's
 * life, so only a reload can fetch it again. A render error can retry in place.
 */
export function isPageImportFailure(error: Error): boolean {
  return IMPORT_FAILURE.test(error.message);
}

interface RouteErrorBoundaryState {
  readonly error: Error | null;
}

/**
 * Catches a page that fails to load or render. It sits inside the sync and decision
 * providers, so the draft connection stays mounted while the manager recovers.
 * Give it a `key` per route so navigating away clears the error.
 */
export class RouteErrorBoundary extends React.Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  override state: RouteErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): RouteErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    console.error('[app] Page failed to render', error, info.componentStack);
  }

  private readonly retry = (): void => {
    this.setState({ error: null });
  };

  private readonly reload = (): void => {
    window.location.reload();
  };

  override render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { onReturnToBoard } = this.props;
    const needsReload = isPageImportFailure(error);
    return (
      <main className="draft-route-error" role="alert">
        <CircleAlert className="size-5 shrink-0" aria-hidden="true" />
        <div>
          <h1>This page couldn’t load</h1>
          <p>
            The draft connection is still running.{' '}
            {needsReload
              ? 'The page didn’t download; reloading the app fetches it again. A mock draft restarts when the app reloads.'
              : onReturnToBoard ? 'Return to the board or try again.' : 'Try again, or reload the app if it keeps failing.'}
          </p>
          <div className="draft-route-error-actions">
            {onReturnToBoard ? <Button size="sm" onClick={onReturnToBoard}>Back to draft board</Button> : null}
            {needsReload
              ? <Button size="sm" variant="outline" onClick={this.reload}>Reload app</Button>
              : <Button size="sm" variant="outline" onClick={this.retry}>Try again</Button>}
          </div>
        </div>
      </main>
    );
  }
}
