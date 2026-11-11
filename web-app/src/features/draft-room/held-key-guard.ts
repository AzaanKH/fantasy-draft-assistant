import { isEditableTarget } from './pool-keyboard';

/** Keys that act on a control (Enter, Space) or draft and queue (Q, 1-4): holding one must act exactly once. */
const ACTION_KEYS = new Set(['Enter', ' ', 'q', 'Q', '1', '2', '3', '4']);

/**
 * Stops the key repeats of a held action key before any control sees them: a native button repeats its click while
 * Enter is held, and a handler that forgets `event.repeat` would act again. Typing in a field keeps its repeats
 * (holding "4" in the search box still types 4s); a held Enter there is stopped too, so a form never submits twice.
 * Arrows, Page keys and Escape keep repeating, so lists still scroll by holding them.
 */
export function installHeldKeyGuard(target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!event.repeat || !ACTION_KEYS.has(event.key)) return;
    if (event.key !== 'Enter' && isEditableTarget(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
  };
  target.addEventListener('keydown', onKeyDown, { capture: true });
  return () => { target.removeEventListener('keydown', onKeyDown, { capture: true }); };
}
