import * as React from 'react';
import type { Player } from '@fantasy-draft/shared/league';
import {
  ENTER_ACTION_LABELS,
  isEditableTarget,
  isSearchShortcut,
  moveActiveIndex,
  resolveEnterAction,
  type PoolEnterAction,
} from './pool-keyboard';

/** Frames to wait for a collapsed dock to open (and drop `inert`) before giving up on focusing search. */
const REVEAL_FRAME_LIMIT = 6;

/** Hidden description of the active cell (see `activeHint`). */
export const POOL_ACTIVE_HINT_ID = 'draft-pool-active-hint';

/** The player-name gridcell of a pool row: the grid's active descendant while that row is highlighted. */
export function poolCellId(playerId: string): string {
  return `${poolRowId(playerId)}-player`;
}

export function poolRowId(playerId: string): string {
  return `draft-pool-row-${playerId}`;
}

interface PoolKeyboardOptions {
  readonly rows: readonly { readonly player: Player }[];
  readonly sessionMode: 'setup' | 'mock' | 'live';
  readonly canDraftPlayer: (player: Player) => boolean;
  readonly canRecordProvisional: boolean;
  readonly isQueued: (playerId: string) => boolean;
  readonly onDraft: (player: Player) => void;
  readonly onRecord: (playerId: string) => void;
  readonly onAddToQueue: (playerId: string) => void;
  readonly onToggleQueue: (playerId: string) => void;
  /** Keeps the highlighted row rendered in the virtualized list. */
  readonly scrollToIndex: (index: number) => void;
  /** Opens a collapsed dock so search can take focus; without it, shortcuts do nothing while hidden. */
  readonly onRevealRequest?: () => void;
}

export interface PoolKeyboard {
  readonly searchRef: React.RefObject<HTMLInputElement>;
  readonly listRef: React.MutableRefObject<HTMLDivElement | null>;
  readonly activePlayerId: string | null;
  /** Player-cell id for the grid's aria-activedescendant. */
  readonly activeDescendantId: string | undefined;
  /** Search edits invalidate the highlight. */
  readonly clearHighlight: () => void;
  readonly onSearchKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  readonly onListKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  /** Footer hint for what Enter does now. */
  readonly enterHint: string;
  /** Polite live-region text: the highlighted row, its queue state and the Enter action. */
  readonly announcement: string;
  /** Position, queue state and Enter action for the active cell's description. */
  readonly activeHint: string;
}

/**
 * Keyboard workflow for the player pool: `/` or Cmd/Ctrl+K focuses search, arrows move a
 * highlight, Enter drafts, records (with confirmation) or adds to the queue, and `q` toggles the queue.
 */
export function usePoolKeyboard({
  rows,
  sessionMode,
  canDraftPlayer,
  canRecordProvisional,
  isQueued,
  onDraft,
  onRecord,
  onAddToQueue,
  onToggleQueue,
  scrollToIndex,
  onRevealRequest,
}: PoolKeyboardOptions): PoolKeyboard {
  const searchRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const [activePlayerId, setActivePlayerId] = React.useState<string | null>(null);
  // Feedback that is not a highlight change, such as Enter on an already queued player.
  const [notice, setNotice] = React.useState('');
  const activeIndex = activePlayerId === null ? -1 : rows.findIndex((row) => row.player.id === activePlayerId);
  const activeRow = activeIndex >= 0 ? rows[activeIndex] : undefined;

  const enterActionFor = (player: Player): PoolEnterAction => resolveEnterAction({
    sessionMode,
    canDraftPlayer: canDraftPlayer(player),
    canRecordProvisional,
    isQueued: isQueued(player.id),
  });

  const highlight = (index: number): void => {
    const row = rows[index];
    if (!row) return;
    setNotice('');
    setActivePlayerId(row.player.id);
    scrollToIndex(index);
  };
  const focusSearch = (): void => {
    searchRef.current?.focus();
    searchRef.current?.select();
  };
  const runEnterAction = (player: Player): void => {
    const action = enterActionFor(player);
    if (action === 'draft') onDraft(player);
    else if (action === 'record') onRecord(player.id);
    else if (action === 'queue') onAddToQueue(player.id);
    else setNotice(`${player.name} is already in your queue. Press Q to remove.`);
  };

  // The document listener reads the latest reveal callback without re-subscribing.
  const revealRef = React.useRef(onRevealRequest);
  React.useEffect(() => { revealRef.current = onRevealRequest; });
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || !isSearchShortcut(event) || isEditableTarget(event.target)) return;
      // Leave shortcuts to an open dialog or menu.
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      const input = searchRef.current;
      if (!input) return;
      const hidden = input.closest('[inert]') !== null;
      const reveal = revealRef.current;
      // A collapsed dock makes search inert; only claim the key when it can be revealed.
      if (hidden && !reveal) return;
      event.preventDefault();
      if (!hidden) { input.focus(); input.select(); return; }
      reveal?.();
      const focusWhenVisible = (frame: number): void => {
        if (input.closest('[inert]') === null) { input.focus(); input.select(); return; }
        if (frame < REVEAL_FRAME_LIMIT) window.requestAnimationFrame(() => { focusWhenVisible(frame + 1); });
      };
      window.requestAnimationFrame(() => { focusWhenVisible(0); });
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); };
  }, []);

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' && rows.length > 0) {
      event.preventDefault();
      highlight(activeIndex >= 0 ? activeIndex : 0);
      listRef.current?.focus();
    } else if (event.key === 'Enter' && rows.length > 0) {
      // Typing a name and pressing Enter only highlights the top result; a second, separate Enter acts on it. A held
      // Enter's repeats are ignored, so one long press can never highlight and then draft.
      event.preventDefault();
      if (event.repeat) return;
      if (activeRow) runEnterAction(activeRow.player);
      else highlight(0);
    }
  };

  const onListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    // Buttons inside rows keep their native keyboard behavior.
    if (event.target !== event.currentTarget || event.metaKey || event.ctrlKey || event.altKey) return;
    const next = moveActiveIndex(activeIndex >= 0 ? activeIndex : null, event.key, rows.length);
    if (next !== null) {
      event.preventDefault();
      if (event.key === 'ArrowUp' && activeIndex === 0) { setActivePlayerId(null); focusSearch(); return; }
      highlight(next);
      return;
    }
    if (event.key === 'Escape' || event.key === '/') {
      event.preventDefault();
      focusSearch();
      return;
    }
    if (!activeRow) return;
    // Arrows above repeat while held; actions never do.
    if (event.repeat && (event.key === 'Enter' || event.key === 'q' || event.key === 'Q')) { event.preventDefault(); return; }
    if (event.key === 'Enter') {
      event.preventDefault();
      runEnterAction(activeRow.player);
    } else if (event.key === 'q' || event.key === 'Q') {
      event.preventDefault();
      setNotice('');
      onToggleQueue(activeRow.player.id);
    }
  };

  const activeAction = activeRow ? enterActionFor(activeRow.player) : null;
  const enterHint = ENTER_ACTION_LABELS[activeAction
    ?? (sessionMode === 'mock' ? 'draft' : canRecordProvisional ? 'record' : 'queue')];
  // The grid's active cell is read on its own when it changes; this hint is its description, so the live region
  // carries only action results (e.g. "already in your queue") and nothing is announced twice.
  const activeHint = activeRow && activeAction
    ? `${String(activeIndex + 1)} of ${String(rows.length)}. ${isQueued(activeRow.player.id) ? 'In your queue' : 'Not queued'}. Enter: ${ENTER_ACTION_LABELS[activeAction]}.`
    : '';
  const announcement = notice;

  return {
    searchRef,
    listRef,
    activePlayerId,
    activeDescendantId: activeRow ? poolCellId(activeRow.player.id) : undefined,
    activeHint,
    clearHighlight: (): void => { setActivePlayerId(null); setNotice(''); },
    onSearchKeyDown,
    onListKeyDown,
    enterHint,
    announcement,
  };
}
