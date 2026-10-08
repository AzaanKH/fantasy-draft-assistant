import * as React from 'react';
import { CircleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface RouteErrorBoundaryProps {
  readonly children: React.ReactNode;
  /** Shown when the failed page is not the board, so the manager can get back to it. */
  readonly onReturnToBoard?: () => void;
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

  override render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { onReturnToBoard } = this.props;
    return (
      <main className="draft-route-error" role="alert">
        <CircleAlert className="size-5 shrink-0" aria-hidden="true" />
        <div>
          <h1>This page couldn’t load</h1>
          <p>The draft connection is still running. {onReturnToBoard ? 'Return to the board or try again.' : 'Try again, or reload the app if it keeps failing.'}</p>
          <div className="draft-route-error-actions">
            {onReturnToBoard ? <Button size="sm" onClick={onReturnToBoard}>Back to draft board</Button> : null}
            <Button size="sm" variant="outline" onClick={this.retry}>Try again</Button>
          </div>
        </div>
      </main>
    );
  }
}
