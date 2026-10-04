import * as React from 'react';
import { AnimatePresence, LazyMotion, MotionConfig, useIsPresent } from 'motion/react';
import * as m from 'motion/react-m';
import { cn } from '@/lib/utils';

const MOTION_EASE = [0.22, 1, 0.36, 1] as const;
const CONTENT_TRANSITION = { duration: 0.21, ease: MOTION_EASE };
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
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    });
    return () => { animation.cancel(); };
  }, [duration, element, keyframes, motionKey, reduceMotion]);
}

const FADE_KEYFRAMES: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];

/** Update in place so focus and actions always belong to the current player. */
export function MotionFade({ motionKey, children, className }: {
  readonly motionKey: React.Key;
  readonly children: React.ReactNode;
  readonly className?: string;
}): React.ReactElement {
  const element = React.useRef<HTMLDivElement>(null);
  useChangeAnimation(element, motionKey, FADE_KEYFRAMES, 180);
  return <div ref={element} className={className} data-motion="recommendation-fade">{children}</div>;
}

function MotionSwapContent({
  children,
  className,
  axis,
  distance,
  kind,
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
  readonly axis: 'x' | 'y' | 'none';
  readonly distance: number;
  readonly kind: 'content-swap' | 'player-identity';
}): React.ReactElement {
  const reduceMotion = usePrefersReducedMotion();
  const isPresent = useIsPresent();
  const element = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    // A departing recommendation must not expose stale draft actions or labels.
    if (element.current) element.current.inert = !isPresent;
  }, [isPresent]);

  return (
    <m.div
      ref={element}
      className={className}
      data-motion={kind}
      aria-hidden={isPresent ? undefined : true}
      initial={reduceMotion ? false : {
        opacity: 0,
        x: axis === 'x' ? distance : 0,
        y: axis === 'y' ? distance : 0,
      }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      exit={reduceMotion ? undefined : { opacity: 0, transition: { duration: 0.08 } }}
      transition={reduceMotion ? { duration: 0 } : CONTENT_TRANSITION}
    >
      {children}
    </m.div>
  );
}

export function DecisionSwap({
  motionKey,
  children,
  className,
  axis = 'y',
  distance = 8,
}: {
  readonly motionKey: React.Key;
  readonly children: React.ReactNode;
  readonly className?: string;
  readonly axis?: 'x' | 'y' | 'none';
  readonly distance?: number;
}): React.ReactElement {
  return (
    <AnimatePresence initial={false} mode="wait">
      <MotionSwapContent key={motionKey} className={className} axis={axis} distance={distance} kind="content-swap">
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
      <MotionSwapContent key={motionKey} className={className} axis="x" distance={7} kind="player-identity">
        {children}
      </MotionSwapContent>
    </AnimatePresence>
  );
}

export function MotionMetricSwap({
  motionKey,
  children,
  className,
  as: Component = 'div',
}: {
  readonly motionKey: React.Key;
  readonly children: React.ReactNode;
  readonly className?: string;
  readonly as?: 'div' | 'span';
}): React.ReactElement {
  const element = React.useRef<HTMLElement>(null);
  const keyframes = React.useMemo<Keyframe[]>(() => [
    { opacity: 0.35, transform: 'translateY(4px)' },
    { opacity: 1, transform: 'translateY(0)' },
  ], []);
  useChangeAnimation(element, motionKey, keyframes, 190);

  return (
    <Component ref={element as React.Ref<HTMLDivElement> & React.Ref<HTMLSpanElement>} className={className} data-motion="metric-change">
      {children}
    </Component>
  );
}

export function MotionCount({
  value,
  className,
}: {
  readonly value: number;
  readonly className?: string;
}): React.ReactElement {
  const element = React.useRef<HTMLSpanElement>(null);
  const keyframes = React.useMemo<Keyframe[]>(() => [
    { transform: 'translateY(0) scale(1)', opacity: 1 },
    { transform: 'translateY(-2px) scale(1.18)', opacity: 0.8, offset: 0.42 },
    { transform: 'translateY(0) scale(1)', opacity: 1 },
  ], []);
  useChangeAnimation(element, value, keyframes, 260);

  return (
    <span ref={element} className={className} aria-live="polite" data-motion="count-change">
      {String(value)}
    </span>
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
  // Retained for existing callers; Motion measures the rendered layout.
  readonly order: number;
  readonly rowHeight?: number;
}): React.ReactElement {
  const reduceMotion = usePrefersReducedMotion();

  return (
    <m.div
      className={className}
      data-motion="reorder-item"
      layout={reduceMotion ? false : 'position'}
      initial={reduceMotion ? false : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduceMotion ? { duration: 0 } : {
        duration: 0.24,
        ease: MOTION_EASE,
        layout: { duration: 0.25, ease: MOTION_EASE },
      }}
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
