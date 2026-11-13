import * as React from 'react';
import type { AssistantNavigationTarget } from '@/features/assistant/assistant-navigation';
import { LoadingStatus } from '@/components/skeletons';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { usePlayerDataQuery } from '@/hooks/usePlayerData';
import { LAYOUT_TOKENS, useLayoutPx } from '@/lib/layout-tokens';
import { DraftBoard } from './DraftBoard';
import { DraftDecisionBar } from './DraftDecisionBar';
import { DraftDock } from './DraftDock';
import {
  clampBoardHeight,
  clearStoredBoardHeight,
  DEFAULT_BOARD_HEIGHT,
  MIN_BOARD_HEIGHT,
  MIN_DOCK_HEIGHT,
  readStoredBoardHeight,
  storeBoardHeight,
} from './draft-workspace-layout';

/** Wide, tall windows fit the whole workspace on screen; smaller ones scroll the page. */
const FILL_LAYOUT_QUERY = '(min-width: 64rem) and (min-height: 40rem)';
/** Upper bound for the board when the page scrolls instead of filling the window. */
const SCROLLING_MAX_BOARD_HEIGHT = 720;
const KEYBOARD_STEP = 24;

interface DragState {
  readonly pointerId: number;
  readonly startY: number;
  readonly startHeight: number;
  readonly maxHeight: number;
  /** The height shown on screen; React state catches up when the drag ends. */
  latestHeight: number;
}

/**
 * Sizes the board scrollers directly while dragging, so no React render or inherited CSS variable change
 * happens per pointer move. Fill layout sizes the scroller with flex-basis; scrolling layout uses height.
 */
function showDragHeight(
  stack: HTMLElement | null,
  separator: HTMLElement,
  height: number,
  fillsViewport: boolean
): void {
  const size = `${String(height)}px`;
  for (const scroller of stack?.querySelectorAll<HTMLElement>('.board-scroll') ?? []) {
    if (fillsViewport) scroller.style.flexBasis = size;
    else scroller.style.height = size;
  }
  separator.setAttribute('aria-valuenow', String(height));
  separator.setAttribute('aria-valuetext', `Draft board ${String(height)} pixels tall`);
}

function clearDragHeight(stack: HTMLElement | null): void {
  for (const scroller of stack?.querySelectorAll<HTMLElement>('.board-scroll') ?? []) {
    scroller.style.removeProperty('flex-basis');
    scroller.style.removeProperty('height');
  }
}

function getVisibleHeight(container: HTMLElement | null, selector: string): number | null {
  const element = Array.from(container?.querySelectorAll<HTMLElement>(selector) ?? [])
    .find((candidate) => candidate.offsetHeight > 0);
  return element ? element.getBoundingClientRect().height : null;
}

/** Measures what is on screen, since a short window can shrink the board below its saved height. */
function measureResizeBounds(
  stack: HTMLElement | null,
  fillsViewport: boolean,
  fallbackHeight: number
): { readonly current: number; readonly max: number } {
  const current = getVisibleHeight(stack, '.board-scroll') ?? fallbackHeight;
  if (!fillsViewport) {
    return { current, max: SCROLLING_MAX_BOARD_HEIGHT };
  }
  const dockHeight = getVisibleHeight(stack, '.draft-dock') ?? MIN_DOCK_HEIGHT;
  return { current, max: Math.max(MIN_BOARD_HEIGHT, current + dockHeight - MIN_DOCK_HEIGHT) };
}

export function DraftWorkspace({
  notices,
  onOpenAssistant,
  roundWindowSize,
  setupChecklist,
  toolbarActions,
}: {
  readonly notices?: React.ReactNode;
  /** Readiness blockers. They open the player workspace, so arriving with the data never moves the board. */
  readonly setupChecklist?: React.ReactNode;
  readonly onOpenAssistant: (target: AssistantNavigationTarget) => void;
  readonly roundWindowSize?: number;
  readonly toolbarActions?: React.ReactNode;
}): React.ReactElement {
  const fillsViewport = useMediaQuery(FILL_LAYOUT_QUERY);
  const { isLoading } = usePlayerDataQuery();
  // Until the user drags the board, its height is the window's default and follows resizes (laptop heights
  // show two or three whole rounds); a dragged height is theirs and is kept.
  const defaultBoardHeight = useLayoutPx(LAYOUT_TOKENS.boardDefaultHeight, DEFAULT_BOARD_HEIGHT);
  const [userBoardHeight, setUserBoardHeight] = React.useState<number | null>(readStoredBoardHeight);
  const boardHeight = userBoardHeight ?? defaultBoardHeight;
  const [isDockExpanded, setIsDockExpanded] = React.useState(true);
  // Bumped when a drag ends, so the layout effect clears the inline drag sizes after the height commits.
  const [finishedDrags, setFinishedDrags] = React.useState(0);
  const [maxBoardHeight, setMaxBoardHeight] = React.useState(SCROLLING_MAX_BOARD_HEIGHT);
  const stackRef = React.useRef<HTMLDivElement>(null);
  const dragRef = React.useRef<DragState | null>(null);
  const getResizeBounds = (): { readonly current: number; readonly max: number } =>
    measureResizeBounds(stackRef.current, fillsViewport, boardHeight);

  React.useLayoutEffect(() => {
    const stack = stackRef.current;
    if (!stack || !isDockExpanded) return undefined;
    const update = (): void => {
      // Before the board measures, fall back to the window's token-derived default, not the fixed constant.
      setMaxBoardHeight(measureResizeBounds(stack, fillsViewport, defaultBoardHeight).max);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stack);
    return () => { observer.disconnect(); };
  }, [defaultBoardHeight, fillsViewport, isDockExpanded]);

  // Runs after the committed --draft-board-height reaches the DOM and before paint, so the board never jumps.
  React.useLayoutEffect(() => {
    if (dragRef.current) return;
    clearDragHeight(stackRef.current);
  }, [finishedDrags]);

  const commitHeight = (height: number): void => {
    setUserBoardHeight(height);
    storeBoardHeight(height);
  };
  const resetHeight = (): void => {
    setUserBoardHeight(null);
    clearStoredBoardHeight();
  };

  const dragTo = (drag: DragState, event: React.PointerEvent<HTMLDivElement>): void => {
    const next = clampBoardHeight(drag.startHeight + event.clientY - drag.startY, drag.maxHeight);
    if (next === drag.latestHeight) return;
    drag.latestHeight = next;
    showDragHeight(stackRef.current, event.currentTarget, next, fillsViewport);
  };

  const finishDrag = (drag: DragState): void => {
    dragRef.current = null;
    stackRef.current?.removeAttribute('data-resizing');
    setFinishedDrags((count) => count + 1);
    // A press without movement keeps following the window's default.
    if (drag.latestHeight !== clampBoardHeight(drag.startHeight, drag.maxHeight) || userBoardHeight !== null) commitHeight(drag.latestHeight);
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    // A cancelled pointer has no meaningful position, so it keeps the last height shown.
    if (event.type === 'pointerup') dragTo(drag, event);
    finishDrag(drag);
  };

  // Collapsing unmounts the separator, so its pointerup never fires; keep the height the drag reached.
  const changeDockExpanded = (expanded: boolean): void => {
    if (!expanded && dragRef.current) finishDrag(dragRef.current);
    setIsDockExpanded(expanded);
  };

  const visibleBoardHeight = Math.round(Math.min(boardHeight, maxBoardHeight));

  return (
    <main className="draft-workspace w-full px-3 py-4 sm:px-4" data-layout={fillsViewport ? 'fill' : 'scroll'} aria-busy={isLoading || undefined}>
      <h1 className="sr-only">Draft room</h1>
      {isLoading ? <LoadingStatus label="Loading player data" /> : null}
      {notices}
      {/* data-resizing is toggled directly during a drag, so starting one does not re-render the board. */}
      <div ref={stackRef} className="draft-workspace-stack">
        <DraftBoard
          boardHeight={fillsViewport ? boardHeight : Math.min(boardHeight, SCROLLING_MAX_BOARD_HEIGHT)}
          fillsSpace={fillsViewport && !isDockExpanded}
          roundWindowSize={roundWindowSize}
          toolbarActions={toolbarActions}
        />
        <DraftDecisionBar onOpenAssistant={onOpenAssistant} />
        {isDockExpanded ? (
          <div
            role="separator"
            tabIndex={0}
            aria-orientation="horizontal"
            aria-label="Resize draft board"
            aria-valuemin={MIN_BOARD_HEIGHT}
            aria-valuemax={Math.round(maxBoardHeight)}
            aria-valuenow={visibleBoardHeight}
            aria-valuetext={`Draft board ${String(visibleBoardHeight)} pixels tall`}
            title="Drag to resize. Double-click to reset."
            className="draft-workspace-resizer"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              const bounds = getResizeBounds();
              const startHeight = clampBoardHeight(bounds.current, bounds.max);
              setMaxBoardHeight(bounds.max);
              dragRef.current = {
                pointerId: event.pointerId,
                startY: event.clientY,
                startHeight: bounds.current,
                maxHeight: bounds.max,
                latestHeight: startHeight,
              };
              if (userBoardHeight !== null) setUserBoardHeight(startHeight);
              stackRef.current?.setAttribute('data-resizing', '');
            }}
            onPointerMove={(event) => {
              const drag = dragRef.current;
              if (!drag || drag.pointerId !== event.pointerId) return;
              dragTo(drag, event);
            }}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onDoubleClick={resetHeight}
            onKeyDown={(event) => {
              const bounds = getResizeBounds();
              const next = {
                ArrowUp: bounds.current - KEYBOARD_STEP,
                ArrowDown: bounds.current + KEYBOARD_STEP,
                Home: MIN_BOARD_HEIGHT,
                End: bounds.max,
              }[event.key];
              if (next === undefined) return;
              event.preventDefault();
              commitHeight(clampBoardHeight(next, bounds.max));
            }}
          >
            <span className="draft-workspace-resizer-grip" aria-hidden="true" />
          </div>
        ) : null}
        <DraftDock
          checklist={setupChecklist}
          expanded={isDockExpanded}
          onExpandedChange={changeDockExpanded}
          onOpenAssistant={onOpenAssistant}
        />
      </div>
    </main>
  );
}
