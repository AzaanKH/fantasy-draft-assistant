import * as React from 'react';
import { Bot, LayoutGrid, ShieldCheck } from 'lucide-react';
import { ThemeMenu } from '@/features/theme/ThemeMenu';
import type { AppRoute } from '@/lib/app-route';
import { cn } from '@/lib/utils';
import type { KeeperPreloadStatus } from '@/hooks/useKeeperPreload';
import { DraftSessionStatus } from './DraftSessionStatus';

export function DraftHeader({
  route,
  onNavigate,
  secondaryControls,
  connectionControl,
  keeperStatus,
  onManageLeagueSettings,
}: {
  readonly keeperStatus?: KeeperPreloadStatus;
  readonly onManageLeagueSettings?: () => void;
  readonly route: AppRoute;
  readonly onNavigate: (route: AppRoute) => void;
  readonly secondaryControls?: React.ReactNode;
  readonly connectionControl?: React.ReactNode;
}): React.ReactElement {
  const headerRef = React.useRef<HTMLElement>(null);
  React.useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const updateHeight = (): void => {
      document.documentElement.style.setProperty('--draft-header-height', `${String(header.getBoundingClientRect().height)}px`);
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(header);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--draft-header-height');
    };
  }, []);
  return (
    <header ref={headerRef} className="draft-app-header sticky top-0 z-40 border-b border-border/70 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
      <div className="draft-header-main w-full items-center gap-2 px-2 sm:gap-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-1 sm:gap-5">
          <div className="hidden items-center gap-2 text-sm font-bold sm:flex sm:text-base">
            <ShieldCheck className="size-5 text-emerald-600 dark:text-emerald-300" />
            <span className="hidden sm:inline">Fantasy Draft</span>
          </div>
          <nav className="flex h-16 items-stretch" aria-label="Primary navigation">
            <button
              type="button"
              aria-current={route === 'draft' ? 'page' : undefined}
              onClick={() => { onNavigate('draft'); }}
              className={cn(
                'relative flex items-center gap-2 px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-4',
                route === 'draft'
                  ? 'text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-emerald-500'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <LayoutGrid className="size-4" /> Draft workspace
            </button>
            <button
              type="button"
              aria-current={route === 'assistant' ? 'page' : undefined}
              onClick={() => { onNavigate('assistant'); }}
              className={cn(
                'relative flex items-center gap-2 px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-4',
                route === 'assistant'
                  ? 'text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-emerald-500'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Bot className="size-4" /> Assistant
            </button>
          </nav>
        </div>
        <div className="draft-header-context">
          <DraftSessionStatus keeperStatus={keeperStatus} onManageLeagueSettings={onManageLeagueSettings} />
          {secondaryControls ? <div className="draft-header-mobile-controls">{secondaryControls}</div> : null}
        </div>
        <div className="draft-header-controls flex min-w-0 items-center gap-1 sm:gap-2">
          {connectionControl}
          {secondaryControls ? (
            <div className="draft-header-desktop-controls items-center gap-2">
              {secondaryControls}
            </div>
          ) : null}
          <ThemeMenu />
        </div>
      </div>
    </header>
  );
}
