import * as React from 'react';

/**
 * How a control's visibility is judged. A control that shows a failure (Draft, which becomes Retry) must be reachable
 * whole: `fully` counts only an element entirely inside the viewport and its scrolling ancestors, and
 * `belowStickyHeader` treats the strip under the app's sticky header as off screen, because a control scrolled
 * beneath it intersects the viewport but cannot be seen or clicked.
 */
export interface ViewportVisibilityOptions {
  readonly fully?: boolean;
  readonly belowStickyHeader?: boolean;
}

/** Sub-pixel rounding can leave a whole element at a ratio just under 1. */
const FULLY_VISIBLE_RATIO = 0.99;

/** Whether one observer entry counts as visible under `options`. */
export function isEntryVisible(entry: Pick<IntersectionObserverEntry, 'isIntersecting' | 'intersectionRatio'>, fully: boolean): boolean {
  return fully ? entry.isIntersecting && entry.intersectionRatio >= FULLY_VISIBLE_RATIO : entry.isIntersecting;
}

/** The observer's root margin: the sticky header's height is removed from the top of the viewport. */
export function stickyHeaderRootMargin(inset: number): string {
  return `${String(-Math.max(0, Math.ceil(inset)))}px 0px 0px 0px`;
}

/** DraftHeader publishes its measured height here; 0 where no sticky header is mounted. */
function readStickyHeaderInset(): number {
  if (typeof document === 'undefined') return 0;
  const value = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--draft-header-height'));
  return Number.isFinite(value) ? value : 0;
}

/** The sticky header's current height, re-read when the window resizes (the header can wrap). */
export function useStickyHeaderInset(enabled: boolean): number {
  const [inset, setInset] = React.useState(() => (enabled ? readStickyHeaderInset() : 0));
  React.useEffect(() => {
    if (!enabled) { setInset(0); return; }
    const update = (): void => { setInset(readStickyHeaderInset()); };
    update();
    window.addEventListener('resize', update);
    const header = document.querySelector('.draft-app-header');
    const observer = header && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    if (header) observer?.observe(header);
    return () => { window.removeEventListener('resize', update); observer?.disconnect(); };
  }, [enabled]);
  return inset;
}

function observerOptions({ fully = false }: ViewportVisibilityOptions, inset: number): IntersectionObserverInit {
  return { threshold: fully ? [0, FULLY_VISIBLE_RATIO, 1] : 0, ...(inset > 0 ? { rootMargin: stickyHeaderRootMargin(inset) } : {}) };
}

/**
 * Which of `ids` have an element (`[attribute="<id>"]` inside `container`) on screen, including clipping by
 * scrolling ancestors. Elements count as visible until the observer says otherwise, and always where
 * IntersectionObserver is missing (tests), so nothing reads as hidden before it has been measured. `mounted` re-observes
 * once a container that rendered a placeholder shows its elements.
 */
export function useIdsInViewport(
  container: React.RefObject<Element | null>,
  attribute: string,
  ids: readonly string[],
  mounted = true,
  options: ViewportVisibilityOptions = {}
): readonly string[] {
  const [hidden, setHidden] = React.useState<ReadonlySet<string>>(() => new Set());
  const key = ids.join('\u0000');
  const fully = options.fully ?? false;
  const inset = useStickyHeaderInset(options.belowStickyHeader ?? false);
  React.useEffect(() => {
    const root = container.current;
    if (!mounted || !root || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      setHidden((current) => {
        const next = new Set(current);
        for (const entry of entries) {
          const id = entry.target.getAttribute(attribute);
          if (id === null) continue;
          if (isEntryVisible(entry, fully)) next.delete(id);
          else next.add(id);
        }
        return next.size === current.size && [...next].every((id) => current.has(id)) ? current : next;
      });
    }, observerOptions({ fully }, inset));
    root.querySelectorAll(`[${attribute}]`).forEach((element) => { observer.observe(element); });
    return () => { observer.disconnect(); };
  }, [attribute, container, fully, inset, key, mounted]);
  return React.useMemo(() => ids.filter((id) => !hidden.has(id)), [hidden, ids]);
}

/**
 * Whether the element behind the returned ref is on screen; true until measured and without IntersectionObserver.
 * See ViewportVisibilityOptions for `fully` and `belowStickyHeader`.
 */
export function useInViewport<T extends Element>(options: ViewportVisibilityOptions = {}): readonly [React.RefCallback<T>, boolean] {
  const [element, setElement] = React.useState<T | null>(null);
  const [visible, setVisible] = React.useState(true);
  const fully = options.fully ?? false;
  const inset = useStickyHeaderInset(options.belowStickyHeader ?? false);
  React.useEffect(() => {
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) setVisible(isEntryVisible(entry, fully));
    }, observerOptions({ fully }, inset));
    observer.observe(element);
    return () => { observer.disconnect(); };
  }, [element, fully, inset]);
  return [setElement, visible] as const;
}

/**
 * The rows of a virtual list whose whole box is inside its scroller, below any sticky heading at the scroller's top.
 * The virtualizer's own range also counts rows only partly in view (under the heading, or cut at the bottom edge).
 */
export function fullyVisibleItems<T extends { readonly start: number; readonly end: number }>(
  items: readonly T[],
  { scrollOffset, viewportHeight, stickyTop }: { readonly scrollOffset: number; readonly viewportHeight: number; readonly stickyTop: number }
): readonly T[] {
  const top = scrollOffset + stickyTop;
  const bottom = scrollOffset + viewportHeight;
  // A row taller than the space below the heading can never be whole; its top edge in view is the most there is.
  return items.filter((item) => item.start >= top - 0.5 && (item.end <= bottom + 0.5 || (item.end - item.start > bottom - top && item.start < bottom)));
}
