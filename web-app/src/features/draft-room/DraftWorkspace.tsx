import * as React from 'react';
import type { AssistantNavigationTarget } from '@/features/assistant/assistant-navigation';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { DraftBoard } from './DraftBoard';
import { DraftDecisionBar } from './DraftDecisionBar';
import { DraftDock } from './DraftDock';
import {
  clampBoardHeight,
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
    return { current, max: Math.max(current, SCROLLING_MAX_BOARD_HEIGHT) };
  }
  const dockHeight = getVisibleHeight(stack, '.draft-dock') ?? MIN_DOCK_HEIGHT;
  return { current, max: Math.max(MIN_BOARD_HEIGHT, current + dockHeight - MIN_DOCK_HEIGHT) };
}

export function DraftWorkspace({
  notices,
  onOpenAssistant,
  roundWindowSize,
  toolbarActions,
}: {
  readonly notices?: React.ReactNode;
  readonly onOpenAssistant: (target: AssistantNavigationTarget) => void;
  readonly roundWindowSize?: number;
  readonly toolbarActions?: React.ReactNode;
}): React.ReactElement {
  const fillsViewport = useMediaQuery(FILL_LAYOUT_QUERY);
  const [boardHeight, setBoardHeight] = React.useState(readStoredBoardHeight);
  const [isDockExpanded, setIsDockExpanded] = React.useState(true);
  const [isResizing, setIsResizing] = React.useState(false);
  const [maxBoardHeight, setMaxBoardHeight] = React.useState(SCROLLING_MAX_BOARD_HEIGHT);
  const stackRef = React.useRef<HTMLDivElement>(null);
  const dragRef = React.useRef<DragState | null>(null);
  const getResizeBounds = (): { readonly current: number; readonly max: number } =>
    measureResizeBounds(stackRef.current, fillsViewport, boardHeight);

  React.useLayoutEffect(() => {
    const stack = stackRef.current;
    if (!stack || !isDockExpanded) return undefined;
    const update = (): void => {
      setMaxBoardHeight(measureResizeBounds(stack, fillsViewport, DEFAULT_BOARD_HEIGHT).max);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stack);
    return () => { observer.disconnect(); };
  }, [fillsViewport, isDockExpanded]);

  const commitHeight = (height: number): void => {
    setBoardHeight(height);
    storeBoardHeight(height);
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setIsResizing(false);
    storeBoardHeight(clampBoardHeight(drag.startHeight + event.clientY - drag.startY, drag.maxHeight));
  };

  const visibleBoardHeight = Math.round(Math.min(boardHeight, maxBoardHeight));

  return (
    <main className="draft-workspace w-full px-3 py-4 sm:px-4" data-layout={fillsViewport ? 'fill' : 'scroll'}>
      {notices}
      <div ref={stackRef} className="draft-workspace-stack" data-resizing={isResizing || undefined}>
        <DraftBoard
          boardHeight={boardHeight}
          fillsSpace={fillsViewport && !isDockExpanded}
          roundWindowSize={roundWindowSize}
          toolbarActions={toolbarActions}
        />
        <DraftDecisionBar compact onOpenAssistant={onOpenAssistant} />
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
              setMaxBoardHeight(bounds.max);
              dragRef.current = {
                pointerId: event.pointerId,
                startY: event.clientY,
                startHeight: bounds.current,
                maxHeight: bounds.max,
              };
              setBoardHeight(clampBoardHeight(bounds.current, bounds.max));
              setIsResizing(true);
            }}
            onPointerMove={(event) => {
              const drag = dragRef.current;
              if (!drag || drag.pointerId !== event.pointerId) return;
              setBoardHeight(clampBoardHeight(drag.startHeight + event.clientY - drag.startY, drag.maxHeight));
            }}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onDoubleClick={() => { commitHeight(clampBoardHeight(DEFAULT_BOARD_HEIGHT, getResizeBounds().max)); }}
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
          expanded={isDockExpanded}
          onExpandedChange={setIsDockExpanded}
          onOpenAssistant={onOpenAssistant}
        />
      </div>
    </main>
  );
}
