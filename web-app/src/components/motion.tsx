import * as React from 'react';
import { AnimatePresence, LazyMotion, MotionConfig, useIsPresent } from 'motion/react';
import * as m from 'motion/react-m';
import { cn } from '@/lib/utils';

/** Mirrors --motion-* in design-tokens.css (generated from docs/design-system/tokens.json). */
const MOTION_EASE = [0.22, 1, 0.36, 1] as const;
export const MOTION_EASE_CSS = `cubic-bezier(${MOTION_EASE.join(', ')})`;
export const MOTION_MS = { feedback: 150, content: 210, layout: 280, exit: 100 } as const;

const CONTENT_TRANSITION = { duration: MOTION_MS.content / 1000, ease: MOTION_EASE };
const loadMotionFeatures = () => import('./motion-features').then((module) => module.default);

export function MotionProvider({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  const reduceMotion = usePrefersReducedMotion();

  return (
    <MotionConfig
      reducedMotion={reduceMotion ? 'always' : 'never'}
      transition={reduceMotion ? { duration: 0 } : CONTENT_TRANSITION}
    >
      <LazyMotion features={loadMotionFeatures} strict>{children}</LazyMotion>
    </MotionConfig>
  );
}

function getReducedMotionPreference(): boolean {
  return isMotionDisabled() || (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function isMotionDisabled(): boolean {
  return typeof document !== 'undefined' &&
    document.documentElement.hasAttribute('data-visual-test');
}

function subscribeToReducedMotion(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  mediaQuery.addEventListener('change', listener);
  return () => { mediaQuery.removeEventListener('change', listener); };
}

export function usePrefersReducedMotion(): boolean {
  return React.useSyncExternalStore(
    subscribeToReducedMotion,
    getReducedMotionPreference,
    () => false
  );
}

function useChangeAnimation(
  element: React.RefObject<HTMLElement>,
  motionKey: React.Key,
  keyframes: Keyframe[],
  duration: number
): void {
  const reduceMotion = usePrefersReducedMotion();
  const previousKey = React.useRef(motionKey);

  React.useLayoutEffect(() => {
    const changed = !Object.is(previousKey.current, motionKey);
    previousKey.current = motionKey;
    if (!changed || reduceMotion || !element.current) return;

    const animation = element.current.animate(keyframes, {
      duration,
      easing: MOTION_EASE_CSS,
    });
    return () => { animation.cancel(); };
  }, [duration, element, keyframes, motionKey, reduceMotion]);
}

/** Returns whether the element is still present; an exiting element is inert. */
function useInertWhenExiting(element: React.RefObject<HTMLElement | null>): boolean {
  const isPresent = useIsPresent();
  React.useLayoutEffect(() => {
    if (element.current) element.current.inert = !isPresent;
  }, [element, isPresent]);
  return isPresent;
}

const FADE_KEYFRAMES: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];

/** Update in place so focus and actions always belong to the current player. */
export function MotionFade({ motionKey, children, className }: {
  readonly motionKey: React.Key;
  readonly children: React.ReactNode;
  readonly className?: string;
}): React.ReactElement {
  const element = React.useRef<HTMLDivElement>(null);
  useChangeAnimation(element, motionKey, FADE_KEYFRAMES, MOTION_MS.feedback);
  return <div ref={element} className={className} data-motion="recommendation-fade">{children}</div>;
}

const SWAP_TRANSITION = { duration: MOTION_MS.feedback / 1000, ease: MOTION_EASE };

function MotionSwapContent({
  children,
  className,
  kind,
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
  readonly kind: 'content-swap' | 'player-identity';
}): React.ReactElement {
  const reduceMotion = usePrefersReducedMotion();
  const element = React.useRef<HTMLDivElement>(null);
  const isPresent = useInertWhenExiting(element);

  return (
    <m.div
      ref={element}
      className={className}
      data-motion={kind}
      aria-hidden={isPresent ? undefined : true}
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={reduceMotion ? undefined : { opacity: 0, transition: { duration: MOTION_MS.exit / 1000 } }}
      transition={reduceMotion ? { duration: 0 } : SWAP_TRANSITION}
    >
      {children}
    </m.div>
  );
}

export function DecisionSwap({
  motionKey,
  children,
  className,
}: {
  readonly motionKey: React.Key;
  readonly children: React.ReactNode;
  readonly className?: string;
}): React.ReactElement {
  return (
    <AnimatePresence initial={false} mode="wait">
      <MotionSwapContent key={motionKey} className={className} kind="content-swap">
        {children}
      </MotionSwapContent>
    </AnimatePresence>
  );
}

export function MotionIdentitySwap({
  motionKey,
  children,
  className,
}: {
  readonly motionKey: React.Key;
  readonly children: React.ReactNode;
  readonly className?: string;
}): React.ReactElement {
  return (
    <AnimatePresence initial={false} mode="wait">
      <MotionSwapContent key={motionKey} className={className} kind="player-identity">
        {children}
      </MotionSwapContent>
    </AnimatePresence>
  );
}

export function MotionReorderList({
  children,
  className,
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
}): React.ReactElement {
  return (
    <m.div layoutScroll className={className} style={{ overflowAnchor: 'none' }}>
      {children}
    </m.div>
  );
}

export function MotionReorderItem({
  children,
  className,
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
}): React.ReactElement {
  const reduceMotion = usePrefersReducedMotion();

  return (
    <m.div
      className={className}
      data-motion="reorder-item"
      layout={reduceMotion ? false : 'position'}
      transition={reduceMotion ? { duration: 0 } : { layout: { duration: MOTION_MS.layout / 1000, ease: MOTION_EASE } }}
    >
      {children}
    </m.div>
  );
}

export function MotionExpandable({
  open,
  children,
  className,
}: {
  readonly open: boolean;
  readonly children: React.ReactNode;
  readonly className?: string;
}): React.ReactElement {
  const reduceMotion = usePrefersReducedMotion();
  const container = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    if (container.current) container.current.inert = !open;
  }, [open]);

  return (
    <div
      ref={container}
      className={cn('motion-expandable-grid', className)}
      data-state={open ? 'open' : 'closed'}
      data-reduced-motion={reduceMotion ? 'true' : 'false'}
      aria-hidden={!open}
    >
      <div className="motion-expandable-content">
        {children}
      </div>
    </div>
  );
}
