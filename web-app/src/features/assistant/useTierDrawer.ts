import * as React from 'react';

/**
 * The tier view's analysis drawer: open state, the button that opened it (a player can appear in Overall and in
 * their position column) and the focus return when it closes.
 */
export function useTierDrawer(tiersRef: React.RefObject<HTMLElement | null>): {
  readonly isOpen: boolean;
  readonly open: (origin: HTMLElement | null) => void;
  /** Closes and returns focus to the originating button, or to the tier search when that row is gone or drafted. */
  readonly close: () => void;
  /** Drops the drawer without moving focus, e.g. when the Assistant view changes. */
  readonly reset: () => void;
} {
  const [isOpen, setIsOpen] = React.useState(false);
  const origin = React.useRef<HTMLElement | null>(null);
  const open = React.useCallback((from: HTMLElement | null) => {
    origin.current = from;
    setIsOpen(true);
  }, []);
  const reset = React.useCallback(() => {
    origin.current = null;
    setIsOpen(false);
  }, []);
  const close = React.useCallback(() => {
    const from = origin.current;
    reset();
    // After the drawer unmounts.
    window.requestAnimationFrame(() => {
      const tiers = tiersRef.current;
      if (!tiers) return;
      const target = from?.isConnected && !(from instanceof HTMLButtonElement && from.disabled)
        ? from
        : tiers.querySelector<HTMLInputElement>('.rec-search input');
      target?.focus();
    });
  }, [reset, tiersRef]);
  return { isOpen, open, close, reset };
}
