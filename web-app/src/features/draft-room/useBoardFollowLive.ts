import * as React from 'react';
import { isMotionDisabled } from '@/components/motion';
import {
  createProgrammaticScrollGuard,
  getDraftBoardScrollTarget,
  getStickyHeaderHeight,
  isSlotInView,
  STICKY_ROUND_COLUMN_WIDTH,
  type ProgrammaticScrollGuard,
} from './draft-board-scroll';

interface BoardRefs {
  readonly board: React.RefObject<HTMLDivElement | null>;
  readonly slot: React.RefObject<HTMLDivElement | null>;
}

function roundColumnWidth(container: HTMLElement): number {
  return Number(container.dataset.roundColumnWidth) || STICKY_ROUND_COLUMN_WIDTH;
}

/** Frames the board's size must hold still before a resize counts as settled. */
const RESIZE_SETTLE_FRAMES = 2;

/**
 * Keeps the live pick in view. Both views follow it until the user scrolls it out of view, then wait for "Jump to
 * live pick" or the next live pick, whichever comes first. The board's own smooth scrolls are told apart from the
 * user's with a programmatic-scroll guard.
 *
 * `layoutKey` changes whenever the live pick or the board's geometry does, which re-runs the scroll. The board and
 * its grid are observed too: a window resize passes through many intermediate sizes, so the live pick is restored
 * once the size has held still for a few frames, with an instant scroll on both axes (a smooth one started mid-resize
 * can be cut short by the next layout). A deliberate pause (the user scrolled away) is kept, and no scroll that
 * happens while the board is resizing counts as the user's.
 */
export function useBoardFollowLive({ mode, current, full, livePick, layoutKey }: {
  readonly mode: 'current' | 'full';
  readonly current: BoardRefs;
  readonly full: BoardRefs;
  /** The pick on the clock; a new one ends a deliberate pause. */
  readonly livePick: number;
  readonly layoutKey: string;
}): { readonly followLive: boolean; readonly jumpToLive: () => void } {
  const [followLive, setFollowLive] = React.useState(true);
  const followLiveRef = React.useRef(true);
  const [jumpRequest, setJumpRequest] = React.useState(0);
  const programmaticScroll = React.useRef<ProgrammaticScrollGuard | null>(null);
  // True from a size change until the follow-up scroll has landed; scrolls in that window are the layout's.
  const resizingRef = React.useRef(false);
  const updateFollowLive = React.useCallback((follow: boolean) => {
    followLiveRef.current = follow;
    setFollowLive(follow);
  }, []);
  const jumpToLive = React.useCallback(() => {
    updateFollowLive(true);
    setJumpRequest((count) => count + 1);
  }, [updateFollowLive]);
  const fullBoard = full.board;
  const fullSlot = full.slot;
  const currentBoard = current.board;
  const currentSlot = current.slot;
  const activeBoard = mode === 'current' ? currentBoard : fullBoard;
  const activeSlotRef = mode === 'current' ? currentSlot : fullSlot;

  /** Scrolls the active board so its live slot shows; false when the board or slot is not laid out yet. */
  const scrollToLive = React.useCallback((behavior: ScrollBehavior): boolean => {
    if (!followLiveRef.current) return true;
    const container = activeBoard.current;
    const activeSlot = activeSlotRef.current;
    if (!container || !activeSlot || container.clientWidth === 0 || container.clientHeight === 0) return false;
    const containerRect = container.getBoundingClientRect();
    const activeSlotRect = activeSlot.getBoundingClientRect();
    const target = getDraftBoardScrollTarget({
      containerTop: containerRect.top,
      containerLeft: containerRect.left,
      containerScrollTop: container.scrollTop,
      containerScrollLeft: container.scrollLeft,
      containerWidth: container.clientWidth,
      slotTop: activeSlotRect.top,
      slotLeft: activeSlotRect.left,
      slotWidth: activeSlotRect.width,
      stickyHeaderHeight: getStickyHeaderHeight(container),
      stickyColumnWidth: roundColumnWidth(container),
    });
    const moves = Math.abs(target.top - container.scrollTop) >= 1 || Math.abs(target.left - container.scrollLeft) >= 1;
    if (moves) programmaticScroll.current?.begin();
    container.scrollTo({ top: target.top, left: target.left, behavior });
    return true;
  }, [activeBoard, activeSlotRef]);

  // Switching views or a new pick on the clock resumes following. Declared before the scroll effect below, so the
  // scroll that a new pick triggers already sees following resumed.
  React.useEffect(() => { updateFollowLive(true); }, [mode, livePick, updateFollowLive]);

  React.useEffect(() => {
    const container = activeBoard.current;
    if (!container) return;
    // Our own smooth scroll fires scroll events too; the guard stays active until its scrollend (or a fallback timeout).
    const guard = createProgrammaticScrollGuard(container);
    programmaticScroll.current = guard;
    let size = `${String(container.clientWidth)}x${String(container.clientHeight)}`;
    const onScroll = (): void => {
      // A resize can clamp the scroll position; that scroll is the layout's, not the user's.
      const nextSize = `${String(container.clientWidth)}x${String(container.clientHeight)}`;
      if (nextSize !== size) {
        size = nextSize;
        return;
      }
      if (resizingRef.current || guard.isActive()) return;
      const slot = activeSlotRef.current;
      if (!slot) return;
      updateFollowLive(isSlotInView(container.getBoundingClientRect(), slot.getBoundingClientRect(), getStickyHeaderHeight(container), roundColumnWidth(container)));
    };
    // Real input ends the programmatic window at once, so scrolling away right after a pick still counts.
    const onUserInput = (): void => { guard.end(); resizingRef.current = false; };
    const inputs = ['wheel', 'pointerdown', 'touchstart', 'keydown'] as const;
    container.addEventListener('scroll', onScroll, { passive: true });
    for (const type of inputs) container.addEventListener(type, onUserInput, { passive: true });
    return () => {
      guard.dispose();
      if (programmaticScroll.current === guard) programmaticScroll.current = null;
      container.removeEventListener('scroll', onScroll);
      for (const type of inputs) container.removeEventListener(type, onUserInput);
    };
  }, [activeBoard, activeSlotRef, mode, updateFollowLive]);

  // Restore the live pick once the board stops changing size (window resize, dock drag), unless following is paused.
  // `layoutKey` re-attaches the observer, so it always watches the grid that is rendered now.
  React.useEffect(() => {
    const container = activeBoard.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const grid = container.firstElementChild;
    const measure = (): string => `${String(container.clientWidth)}x${String(container.clientHeight)}:${String(container.scrollWidth)}x${String(container.scrollHeight)}`;
    let frame = 0;
    let last = measure();
    let stableFrames = 0;
    const settle = (): void => {
      const next = measure();
      if (next !== last) {
        last = next;
        stableFrames = 0;
      } else {
        stableFrames += 1;
      }
      if (stableFrames < RESIZE_SETTLE_FRAMES) {
        frame = requestAnimationFrame(settle);
        return;
      }
      // Not laid out (a zero-size board mid dock change): nothing to restore, and later scrolls must count again.
      // Not laid out (a zero-size board mid dock change): nothing to restore, and later scrolls must count again.
      if (!scrollToLive('auto')) { resizingRef.current = false; return; }
      // The instant scroll's own scroll event arrives on the next frame; it still belongs to the resize.
      frame = requestAnimationFrame(() => { resizingRef.current = false; });
    };
    const observer = new ResizeObserver(() => {
      if (measure() === last && !resizingRef.current) return;
      resizingRef.current = true;
      stableFrames = 0;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(settle);
    });
    observer.observe(container);
    if (grid) observer.observe(grid);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); resizingRef.current = false; };
  }, [activeBoard, layoutKey, mode, scrollToLive]);

  React.useEffect(() => {
    const reduceMotion = isMotionDisabled() || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    scrollToLive(reduceMotion ? 'auto' : 'smooth');
    // layoutKey and jumpRequest are triggers only: the geometry they stand for is read from the DOM.
  }, [layoutKey, jumpRequest, scrollToLive]);

  return { followLive, jumpToLive };
}
