import { POSITIONS, type Position } from '@fantasy-draft/shared/league';
import * as React from 'react';
import { Bot, Scale, ShieldCheck, Shirt } from 'lucide-react';
import { LoadingStatus, SkeletonBlock, SkeletonText } from '@/components/skeletons';
import { ThemeMenu } from '@/features/theme/ThemeMenu';
import { cn } from '@/lib/utils';

/**
 * The side panel's frame. SidePanelPage loads lazily, so its loading state renders these same pieces
 * from the main chunk, with placeholders where the page shows data.
 */

export type SidePanelView = 'draft' | 'compare' | 'assistant' | 'roster';
export type PositionFilter = 'ALL' | Position;

const POSITION_FILTERS: readonly PositionFilter[] = ['ALL', ...POSITIONS];

/** Card geometry shared by loaded and loading panels. */
export const PANEL_CARD = 'rounded-xl border border-border/80 bg-card p-3 shadow-sm';
export const HERO_CARD = 'rounded-xl border border-border/80 bg-card p-4 shadow-sm';
export const PANEL_LABEL = 'px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground';
export const STATUS_CARD = 'grid grid-cols-[1.55fr_.75fr_1fr] items-center overflow-hidden rounded-xl border border-border/80 bg-card text-[11px] shadow-xs';

export function SidePanelFrame({
  header,
  children,
  navigation,
}: {
  readonly header: React.ReactNode;
  readonly children: React.ReactNode;
  readonly navigation: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="mx-auto min-h-dvh max-w-[520px] bg-background pb-24 text-foreground">
      {header}
      <main className="space-y-3 p-3">{children}</main>
      {navigation}
    </div>
  );
}

export function SidePanelHeader({
  leading,
  title,
  subtitle,
}: {
  /** Replaces the shield, for example with a back button. */
  readonly leading?: React.ReactNode;
  readonly title: string;
  readonly subtitle?: React.ReactNode;
}): React.ReactElement {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border/70 bg-background/95 px-4 backdrop-blur">
      <div className="flex min-w-0 items-center gap-2.5">
        {leading ?? <ShieldCheck className="size-7 shrink-0 text-emerald-600 dark:text-emerald-300" />}
        <div className="min-w-0">
          <h1 className="truncate text-base font-bold">{title}</h1>
          {subtitle}
        </div>
      </div>
      <ThemeMenu compact />
    </header>
  );
}

export function PositionFilters({
  value,
  onChange,
}: {
  readonly value: PositionFilter;
  readonly onChange: (position: PositionFilter) => void;
}): React.ReactElement {
  return (
    <div
      className="grid grid-cols-7 overflow-hidden rounded-xl border border-border/80 bg-card shadow-xs"
      role="group"
      aria-label="Filter recommendations by position"
    >
      {POSITION_FILTERS.map((position) => (
        <button
          key={position}
          type="button"
          aria-pressed={position === value}
          onClick={() => { onChange(position); }}
          className={cn(
            'h-11 border-r border-border/70 text-[11px] font-bold transition-colors last:border-r-0 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            position === value
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
          )}
        >
          {position}
        </button>
      ))}
    </div>
  );
}

export function SidePanelNavigation({
  view,
  onChange,
}: {
  readonly view: SidePanelView;
  readonly onChange: (view: SidePanelView) => void;
}): React.ReactElement {
  const items: readonly { readonly id: SidePanelView; readonly label: string; readonly icon: typeof ShieldCheck }[] = [
    { id: 'draft', label: 'Draft', icon: ShieldCheck },
    { id: 'compare', label: 'Compare', icon: Scale },
    { id: 'assistant', label: 'Assistant', icon: Bot },
    { id: 'roster', label: 'Roster', icon: Shirt },
  ];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto grid h-[72px] max-w-[520px] grid-cols-4 border-t border-border/80 bg-background/95 px-2 backdrop-blur" aria-label="Side panel navigation">
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.id === view;
        return (
          <button
            key={item.id}
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={() => { onChange(item.id); }}
            className={cn(
              'flex flex-col items-center justify-center gap-1 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              active ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className="size-5" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

/** Loading state for the side panel's Draft view: the real frame, header, filters and navigation, with placeholders for data. */
export function SidePanelSkeleton(): React.ReactElement {
  const ignore = (): void => undefined;
  return (
    <SidePanelFrame
      header={<SidePanelHeader title="Fantasy Draft" />}
      navigation={<SidePanelNavigation view="draft" onChange={ignore} />}
    >
      <LoadingStatus label="Loading draft recommendations" />
      <div className={STATUS_CARD} aria-hidden="true">
        <div className="flex h-14 min-w-0 flex-col justify-center gap-0.5 px-3">
          <span><SkeletonText className="w-20" /></span>
          <span className="text-[10px]"><SkeletonText className="w-16" /></span>
        </div>
        <div className="flex h-14 items-center justify-center border-x border-border/70 px-2"><SkeletonText className="w-8" /></div>
        <div className="flex h-14 items-center justify-end px-3"><SkeletonText className="w-20" /></div>
      </div>
      <PositionFilters value="ALL" onChange={ignore} />
      <section className={HERO_CARD} aria-hidden="true">
        <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Your best pick</div>
        <div className="mt-3 flex items-center gap-3">
          <SkeletonBlock className="size-20 rounded-xl" />
          <div className="min-w-0 flex-1">
            <div className="text-xl"><SkeletonText className="w-40" /></div>
            <div className="mt-1 text-sm"><SkeletonText className="w-20" /></div>
            <div className="mt-2 text-xs"><SkeletonText className="w-36" /></div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 divide-x divide-border">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="min-w-0 px-2 text-center">
              <div className="text-base"><SkeletonText className="w-12" /></div>
              <div className="mt-1 text-[10px]"><SkeletonText className="w-14" /></div>
            </div>
          ))}
        </div>
        <div className="mt-4 text-xs leading-relaxed"><SkeletonText className="w-full" /><br /><SkeletonText className="w-3/4" /></div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <SkeletonBlock className="h-9" />
          <SkeletonBlock className="h-9" />
        </div>
      </section>
      <section className={PANEL_CARD} aria-hidden="true">
        <div className={PANEL_LABEL}>Compare available</div>
        <div className="mt-1.5 space-y-1.5 pt-[26px]">
          {Array.from({ length: 3 }, (_, index) => <SkeletonBlock key={index} className="h-[54px] rounded-lg" />)}
        </div>
        <SkeletonBlock className="mt-3 h-9" />
      </section>
    </SidePanelFrame>
  );
}
