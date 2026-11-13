/** Pure rules behind the player pool's keyboard workflow. */

interface KeyInput {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
}

/** True for text fields, selects, and contenteditable regions, where single-key shortcuts must not fire. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = (target as HTMLInputElement).type;
  return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file'].includes(type);
}

/** `/` or Cmd/Ctrl+K focuses player search. */
export function isSearchShortcut(event: KeyInput): boolean {
  if (event.altKey) return false;
  if (event.key === '/' && !event.metaKey && !event.ctrlKey) return true;
  return (event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey);
}

const PAGE_STEP = 10;

/** Next highlighted row for a navigation key, or null when the key does not navigate. */
export function moveActiveIndex(current: number | null, key: string, count: number): number | null {
  if (count === 0) return null;
  const last = count - 1;
  const from = current === null ? -1 : Math.min(current, last);
  switch (key) {
    case 'ArrowDown': return Math.min(last, from + 1);
    case 'ArrowUp': return Math.max(0, from - 1);
    case 'PageDown': return Math.min(last, Math.max(0, from) + PAGE_STEP);
    case 'PageUp': return Math.max(0, from - PAGE_STEP);
    case 'Home': return 0;
    case 'End': return last;
    default: return null;
  }
}

export type PoolEnterAction = 'draft' | 'record' | 'queue' | 'already-queued';

/**
 * What Enter does on the highlighted player. Mock drafts draft directly on your turn.
 * Live drafts never draft from here: during Manual Continuity, Enter opens the
 * Provisional Pick dialog so the user confirms; otherwise it adds to the queue.
 * Enter only ever adds: on a queued player it does nothing (`q` is the toggle).
 */
export function resolveEnterAction({ sessionMode, canDraftPlayer, canRecordProvisional, isQueued = false }: {
  readonly sessionMode: 'setup' | 'mock' | 'live';
  readonly canDraftPlayer: boolean;
  readonly canRecordProvisional: boolean;
  readonly isQueued?: boolean;
}): PoolEnterAction {
  if (sessionMode === 'mock' && canDraftPlayer) return 'draft';
  if (sessionMode === 'live' && canRecordProvisional) return 'record';
  return isQueued ? 'already-queued' : 'queue';
}

/** Footer hint and screen-reader copy for each Enter outcome. */
export const ENTER_ACTION_LABELS: Readonly<Record<PoolEnterAction, string>> = {
  draft: 'draft',
  record: 'record pick',
  queue: 'add to queue',
  'already-queued': 'already queued',
};
