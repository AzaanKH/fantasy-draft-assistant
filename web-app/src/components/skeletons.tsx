import * as React from 'react';
import { cn } from '@/lib/utils';

function SkeletonBlock({ className }: { readonly className?: string }): React.ReactElement {
  return <div aria-hidden="true" className={cn('rounded-md bg-muted/65', className)} />;
}

function LoadingShell({
  label,
  children,
  className,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
  readonly className?: string;
}): React.ReactElement {
  return (
    <div className={cn('skeleton-enter', className)} role="status" aria-label={label}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export function DecisionBarSkeleton(): React.ReactElement {
  return (
    <LoadingShell
      label="Loading the current Best Pick"
      className="rounded-xl border border-border/75 bg-card/95 px-4 py-3 shadow-sm"
    >
      <div className="flex min-h-16 items-center gap-3">
        <SkeletonBlock className="size-16 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1 space-y-2">
          <SkeletonBlock className="h-2.5 w-20" />
          <SkeletonBlock className="h-5 w-48 max-w-full" />
          <SkeletonBlock className="h-2.5 w-80 max-w-[90%]" />
        </div>
        <SkeletonBlock className="hidden h-10 w-24 sm:block" />
      </div>
    </LoadingShell>
  );
}

export function WorkspacePanelSkeleton(): React.ReactElement {
  return (
    <LoadingShell label="Loading draft tools" className="space-y-2 py-1">
      <div className="flex items-center gap-2 border-y border-border/70 px-3 py-2">
        <SkeletonBlock className="size-10 shrink-0 rounded-full" />
        <div className="flex-1 space-y-1.5">
          <SkeletonBlock className="h-3 w-36" />
          <SkeletonBlock className="h-2.5 w-56 max-w-[75%]" />
        </div>
        <SkeletonBlock className="h-8 w-16" />
      </div>
      <div className="flex items-center gap-2 border-y border-border/70 px-3 py-2">
        <SkeletonBlock className="size-10 shrink-0 rounded-full" />
        <div className="flex-1 space-y-1.5">
          <SkeletonBlock className="h-3 w-44" />
          <SkeletonBlock className="h-2.5 w-48 max-w-[70%]" />
        </div>
        <SkeletonBlock className="h-8 w-16" />
      </div>
    </LoadingShell>
  );
}

export function SuggestionSkeleton(): React.ReactElement {
  return (
    <LoadingShell label="Loading suggestions" className="grid gap-3 lg:grid-cols-3">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="rounded-xl border border-border/70 bg-card p-3">
          <div className="flex gap-3">
            <SkeletonBlock className="size-14 shrink-0 rounded-lg" />
            <div className="flex-1 space-y-2">
              <SkeletonBlock className="h-3 w-16" />
              <SkeletonBlock className="h-4 w-32" />
              <SkeletonBlock className="h-2.5 w-full" />
              <SkeletonBlock className="h-2.5 w-4/5" />
            </div>
          </div>
          <SkeletonBlock className="mt-4 h-8 w-full" />
        </div>
      ))}
    </LoadingShell>
  );
}

export function RecommendationPanelSkeleton(): React.ReactElement {
  return (
    <LoadingShell label="Loading the recommendation" className="rounded-xl border border-border/75 bg-card p-4 shadow-sm">
      <SkeletonBlock className="h-4 w-40" />
      <div className="mt-5 flex gap-3">
        <SkeletonBlock className="size-16 shrink-0 rounded-xl" />
        <div className="flex-1 space-y-2">
          <SkeletonBlock className="h-5 w-44" />
          <SkeletonBlock className="h-3 w-24" />
          <SkeletonBlock className="h-5 w-32" />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden border-y border-border/70 bg-border/70">
        <SkeletonBlock className="h-20 rounded-none bg-card" />
        <SkeletonBlock className="h-20 rounded-none bg-card" />
      </div>
    </LoadingShell>
  );
}

export function CardListSkeleton({ label }: { readonly label: string }): React.ReactElement {
  return (
    <LoadingShell label={label} className="rounded-lg border border-border/75 bg-card p-4">
      <SkeletonBlock className="h-4 w-32" />
      <div className="mt-4 space-y-2">
        {Array.from({ length: 4 }, (_, index) => (
          <SkeletonBlock key={index} className="h-12 w-full" />
        ))}
      </div>
    </LoadingShell>
  );
}

function DraftRouteSkeleton(): React.ReactElement {
  return (
    <main className="w-full space-y-4 px-3 py-4 sm:px-4">
      <SkeletonBlock className="h-12 w-full rounded-none" />
      <DecisionBarSkeleton />
      <section className="overflow-hidden border-y border-border/70 bg-card">
        <div className="flex h-16 items-center justify-between border-b border-border/70 px-4">
          <div className="space-y-2">
            <SkeletonBlock className="h-4 w-28" />
            <SkeletonBlock className="h-2.5 w-44" />
          </div>
          <SkeletonBlock className="h-8 w-36" />
        </div>
        <div className="grid h-[clamp(380px,57vh,650px)] grid-cols-5 gap-px bg-border/65 p-px">
          {Array.from({ length: 25 }, (_, index) => (
            <SkeletonBlock key={index} className="rounded-none bg-card" />
          ))}
        </div>
      </section>
      <SkeletonBlock className="h-48 w-full rounded-none" />
    </main>
  );
}

function AssistantRouteSkeleton(): React.ReactElement {
  return (
    <main className="w-full space-y-4 px-4 py-4">
      <SkeletonBlock className="h-11 w-full rounded-none" />
      <section className="overflow-hidden rounded-xl border border-border/75 bg-card">
        <div className="flex items-center gap-4 p-5">
          <SkeletonBlock className="size-24 shrink-0 rounded-xl" />
          <div className="flex-1 space-y-3">
            <SkeletonBlock className="h-6 w-64 max-w-[80%]" />
            <SkeletonBlock className="h-4 w-96 max-w-full" />
            <SkeletonBlock className="h-3 w-72 max-w-[90%]" />
          </div>
          <SkeletonBlock className="hidden h-20 w-56 lg:block" />
        </div>
        <div className="grid grid-cols-3 gap-px border-t border-border/70 bg-border/70">
          <SkeletonBlock className="h-16 rounded-none bg-card" />
          <SkeletonBlock className="h-16 rounded-none bg-card" />
          <SkeletonBlock className="h-16 rounded-none bg-card" />
        </div>
      </section>
      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <SkeletonBlock className="h-80 w-full rounded-xl" />
        <SkeletonBlock className="h-80 w-full rounded-none" />
      </div>
    </main>
  );
}

function SidepanelRouteSkeleton(): React.ReactElement {
  return (
    <main className="w-full space-y-3 p-3">
      <SkeletonBlock className="h-10 w-full" />
      <RecommendationPanelSkeleton />
      <SkeletonBlock className="h-44 w-full" />
    </main>
  );
}

export function RouteSkeleton({
  route,
}: {
  readonly route: 'draft' | 'assistant' | 'sidepanel';
}): React.ReactElement {
  return (
    <LoadingShell label="Loading decision workspace">
      {route === 'assistant'
        ? <AssistantRouteSkeleton />
        : route === 'sidepanel'
          ? <SidepanelRouteSkeleton />
          : <DraftRouteSkeleton />}
    </LoadingShell>
  );
}
