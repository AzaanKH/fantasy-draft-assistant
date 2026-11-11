/** Fallback for the sticky team header; the rendered height is measured because laptop heights compact it. */
const STICKY_HEADER_HEIGHT = 76;
/** Width of the board's sticky round column on wide boards. */
export const STICKY_ROUND_COLUMN_WIDTH = 56;

export function getStickyHeaderHeight(container: HTMLElement): number {
  return container.querySelector<HTMLElement>('.board-team-header')?.offsetHeight || STICKY_HEADER_HEIGHT;
}

interface DraftBoardScrollTargetInput {
  readonly containerTop: number;
  readonly containerLeft: number;
  readonly containerScrollTop: number;
  readonly containerScrollLeft: number;
  readonly containerWidth: number;
  readonly slotTop: number;
  readonly slotLeft: number;
  readonly slotWidth: number;
  readonly stickyHeaderHeight: number;
  readonly stickyColumnWidth: number;
}

interface DraftBoardScrollTarget {
  readonly top: number;
  readonly left: number;
}

/**
 * Scroll target for the live slot. Vertically, the slot's round starts right under the sticky team header, so the
 * current round is complete and every following round that fits is complete too (centering would cut the rounds
 * on both sides in half and, on a laptop-height board, leave only one whole round). The browser clamps the last
 * rounds to the end of the board, which then shows the final rounds whole. Horizontally the slot is centered.
 * Element rectangles are viewport-relative, so they are normalized to the board's scroll content first, which
 * keeps the result independent of page scroll.
 */
export function getDraftBoardScrollTarget({
  containerTop,
  containerLeft,
  containerScrollTop,
  containerScrollLeft,
  containerWidth,
  slotTop,
  slotLeft,
  slotWidth,
  stickyHeaderHeight,
  stickyColumnWidth,
}: DraftBoardScrollTargetInput): DraftBoardScrollTarget {
  const slotContentTop = slotTop - containerTop + containerScrollTop;
  const slotContentLeft = slotLeft - containerLeft + containerScrollLeft;
  const visibleWidth = Math.max(0, containerWidth - stickyColumnWidth);

  return {
    top: Math.max(0, slotContentTop - stickyHeaderHeight),
    left: Math.max(
      0,
      slotContentLeft - stickyColumnWidth - Math.max(0, (visibleWidth - slotWidth) / 2)
    ),
  };
}

interface Box { readonly top: number; readonly left: number; readonly bottom: number; readonly right: number }

/**
 * Whether any part of the live slot shows in the board's scroll area, outside the sticky team
 * header and round column. Full mode stops following the live pick once the user scrolls it out of view.
 */
export function isSlotInView(container: Box, slot: Box, stickyHeaderHeight: number, stickyColumnWidth: number): boolean {
  const top = container.top + stickyHeaderHeight;
  const left = container.left + stickyColumnWidth;
  return slot.bottom > top && slot.top < container.bottom && slot.right > left && slot.left < container.right;
}

/** Longest a programmatic smooth scroll is trusted to run when the browser never fires `scrollend`. */
export const PROGRAMMATIC_SCROLL_FALLBACK_MS = 1500;

/**
 * Marks the board's own smooth scrolls so the follow-live handler can tell them from the user's.
 * The window closes on the container's `scrollend`, on real user input, or after a fallback timeout
 * for browsers without `scrollend` (or a scroll that never starts).
 */
export interface ProgrammaticScrollGuard {
  begin(fallbackMs?: number): void;
  end(): void;
  isActive(): boolean;
  dispose(): void;
}

export function createProgrammaticScrollGuard(
  container: EventTarget,
  timers: { readonly set: (callback: () => void, ms: number) => number; readonly clear: (id: number) => void } = {
    set: (callback, ms) => window.setTimeout(callback, ms),
    clear: (id) => { window.clearTimeout(id); },
  }
): ProgrammaticScrollGuard {
  let active = false;
  let timer: number | null = null;
  const clearTimer = (): void => {
    if (timer !== null) timers.clear(timer);
    timer = null;
  };
  const end = (): void => {
    active = false;
    clearTimer();
  };
  container.addEventListener('scrollend', end);
  return {
    begin(fallbackMs = PROGRAMMATIC_SCROLL_FALLBACK_MS) {
      clearTimer();
      active = true;
      timer = timers.set(end, fallbackMs);
    },
    end,
    isActive: () => active,
    dispose() {
      end();
      container.removeEventListener('scrollend', end);
    },
  };
}
