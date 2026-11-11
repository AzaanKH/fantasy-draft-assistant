import * as React from 'react';
import { useDraftView } from '@/workspace/useDraftView';
import { isEditableTarget } from './pool-keyboard';
import { useSharedSuggestionActions, WithSuggestionActions } from './SuggestionActionsContext';
import { useSuggestionShortcutScope } from './suggestion-shortcut-preference';

export { SUGGESTION_COUNT } from './SuggestionActionsContext';
/** Marks a rendered suggestion list; a press inside one is that list's own. */
export const SUGGESTION_LIST_ATTRIBUTE = 'data-suggestion-list';

/**
 * Marks a page whose suggestion cards are the page-wide keys' only targets (the Assistant). There a key acts only on a
 * card that is rendered and on screen, with the "Press 1–4" hint showing; a search, the tier view or scrolling that
 * hides the cards makes the keys do nothing. Without it (the draft workspace) the keys follow the dock, which acts
 * on the top suggestions whichever tab is open.
 */
export const SUGGESTION_KEYS_ATTRIBUTE = 'data-suggestion-keys';

/** Laid out, visible, not hidden or inert, and with its vertical middle between the sticky header and the window's bottom. */
function isOnScreen(element: Element | null | undefined): boolean {
  if (!element || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  if (getComputedStyle(element).visibility === 'hidden') return false;
  const box = element.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return false;
  const top = document.querySelector('.draft-app-header')?.getBoundingClientRect().bottom ?? 0;
  const middle = box.top + box.height / 2;
  return middle >= top && middle <= window.innerHeight && box.right > 0 && box.left < window.innerWidth;
}

/**
 * Whether a page-wide key may act on the suggestion for `playerId`: always outside a SUGGESTION_KEYS_ATTRIBUTE page;
 * inside one, only when that player's card and the shortcut hint are both on screen.
 */
export function canActOnSuggestionCard(playerId: string, root: ParentNode = document): boolean {
  const scope = root.querySelector(`[${SUGGESTION_KEYS_ATTRIBUTE}]`);
  if (!scope) return true;
  const list = scope.querySelector(`[${SUGGESTION_LIST_ATTRIBUTE}]`);
  const card = list ? [...list.querySelectorAll('[data-suggestion-player]')].find((item) => item.getAttribute('data-suggestion-player') === playerId) : undefined;
  return isOnScreen(card) && isOnScreen(scope.querySelector('.suggestion-shortcut-hint'));
}

/** A dialog, alert dialog or open menu has the user's attention, so page-wide shortcuts stay out of its way. */
export function isOverlayOpen(): boolean {
  if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return true;
  return document.activeElement instanceof Element && document.activeElement.closest('[role="dialog"], [role="menu"], [role="listbox"]') !== null;
}

/**
 * Keys 1-4 on the clock, from anywhere in the workspace (/draft and /assistant), whichever dock tab is open. They act
 * through the shared suggestion actions, so a card that is on screen shows the pending save and any failure inline,
 * exactly as for a click; otherwise the failure reaches the workspace notice.
 *
 * Never while typing, from an editable element, with a dialog or menu open, or with the preference set to
 * focused-list only. A press inside a list is that list's own (its handler decides). The pick lock applies.
 */
function useSuggestionHotkeys(): void {
  const [scope] = useSuggestionShortcutScope();
  const isMyTurn = useDraftView((view) => view.isMyTurn);
  const shared = useSharedSuggestionActions();
  const actOnSuggestion = shared?.actOnSuggestion;
  const suggestions = shared?.suggestions;

  React.useEffect(() => {
    if (!isMyTurn || scope !== 'anywhere' || !actOnSuggestion || !suggestions) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      // A held key repeats: one press is one action.
      if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
      if (!/^[1-4]$/.test(event.key)) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(`[${SUGGESTION_LIST_ATTRIBUTE}]`)) return;
      if (isEditableTarget(event.target) || isEditableTarget(document.activeElement) || isOverlayOpen()) return;
      const index = Number(event.key) - 1;
      const suggestion = suggestions[index];
      if (!suggestion || !canActOnSuggestionCard(suggestion.playerId)) return;
      if (actOnSuggestion(index)) event.preventDefault();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); };
  }, [actOnSuggestion, isMyTurn, scope, suggestions]);
}

function Hotkeys(): null {
  useSuggestionHotkeys();
  return null;
}

/** Mounts the workspace-wide 1-4 keys once, inside the workspace's shared suggestion actions. */
export function SuggestionHotkeys(): React.ReactElement {
  return <WithSuggestionActions><Hotkeys /></WithSuggestionActions>;
}
