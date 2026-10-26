import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Loading placeholders sit inside the real layout's elements, so loading and loaded states share one geometry.
 * A placeholder only stands in for content that is still loading.
 */

/** A placeholder box; size it like the element it replaces. */
export function SkeletonBlock({ className }: { readonly className?: string }): React.ReactElement {
  return <span aria-hidden="true" className={cn('skeleton-enter block rounded-md bg-muted/65', className)} />;
}

/** A placeholder line inside a real text element, which keeps that element's font size and line height. */
export function SkeletonText({ className }: { readonly className?: string }): React.ReactElement {
  return <span aria-hidden="true" className={cn('skeleton-enter inline-block h-[0.75em] w-24 max-w-full rounded-xs bg-muted/65 align-middle', className)} />;
}

/** Announces a loading region once; its placeholders stay hidden from assistive technology. */
export function LoadingStatus({ label }: { readonly label: string }): React.ReactElement {
  return <span role="status" className="sr-only">{label}</span>;
}
