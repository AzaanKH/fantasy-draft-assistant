import * as React from 'react';
import { MOTION_EASE_CSS, usePrefersReducedMotion } from '@/components/motion';

/**
 * The turn-start ring: each time a new turn of yours starts, the element's `::after` ring scales out and fades.
 * `turn` is the overall pick you are on the clock for, or null while you are not; keying on the pick means
 * back-to-back turns at a snake turnaround pulse twice. Transform and opacity only, via WAAPI's pseudoElement
 * option, and skipped under reduced motion.
 */
export function useTurnStartPulse(ref: React.RefObject<HTMLElement | null>, turn: number | null): void {
  const reduceMotion = usePrefersReducedMotion();
  const previous = React.useRef(turn);
  React.useEffect(() => {
    const justStarted = turn !== null && turn !== previous.current;
    previous.current = turn;
    const element = ref.current;
    if (!justStarted || reduceMotion || !element || typeof element.animate !== 'function') return;
    const animation = element.animate([
      { opacity: 1, transform: 'scale(1)' },
      { opacity: 0, transform: 'scale(1.25)' },
    ], { duration: 600, easing: MOTION_EASE_CSS, pseudoElement: '::after' });
    return () => { animation.cancel(); };
  }, [reduceMotion, ref, turn]);
}
