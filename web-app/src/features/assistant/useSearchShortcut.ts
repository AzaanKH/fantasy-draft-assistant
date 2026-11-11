import * as React from 'react';
import { isEditableTarget, isSearchShortcut } from '@/features/draft-room/pool-keyboard';

/**
 * `/` focuses the search from anywhere on the page except a text field or an open dialog, as in the draft room. Each
 * Assistant view mounts its own (the Suggestions list, Position tiers), so the key always reaches the visible search.
 */
export function useSearchShortcut(searchRef: React.RefObject<HTMLInputElement>): void {
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.repeat || !isSearchShortcut(event) || isEditableTarget(event.target)) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const input = searchRef.current;
      if (!input) return;
      event.preventDefault();
      input.focus();
      input.select();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); };
  }, [searchRef]);
}
