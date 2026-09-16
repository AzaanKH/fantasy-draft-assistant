import * as React from 'react';
import { cn } from '@/lib/utils';

export function MotionProvider({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  return <>{children}</>;
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

    element.current.animate(keyframes, {
      duration,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    });
  }, [duration, element, keyframes, motionKey, reduceMotion]);
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
  const element = React.useRef<HTMLDivElement>(null);
  const keyframes = React.useMemo<Keyframe[]>(() => {
    const transform = axis === 'x'
      ? `translateX(${String(distance)}px)`
      : axis === 'y'
        ? `translateY(${String(distance)}px)`
        : 'none';
    return [
      { opacity: 0, transform },
      { opacity: 1, transform: 'none' },
    ];
  }, [axis, distance]);
  useChangeAnimation(element, motionKey, keyframes, 210);

  return (
    <div ref={element} className={className} data-motion="content-swap">
      {children}
    </div>
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
  const element = React.useRef<HTMLDivElement>(null);
  const keyframes = React.useMemo<Keyframe[]>(() => [
    { opacity: 0.25, transform: 'translateX(7px)' },
    { opacity: 1, transform: 'translateX(0)' },
  ], []);
  useChangeAnimation(element, motionKey, keyframes, 240);

  return (
    <div ref={element} className={className} data-motion="player-identity">
      {children}
    </div>
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

export function MotionReorderItem({
  children,
  className,
  order,
  rowHeight = 61,
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
  readonly order: number;
  readonly rowHeight?: number;
}): React.ReactElement {
  const reduceMotion = usePrefersReducedMotion();
  const previousOrder = React.useRef(order);
  const isMounted = React.useRef(false);
  const element = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    const node = element.current;
    if (!node) return;

    if (!isMounted.current) {
      isMounted.current = true;
      previousOrder.current = order;
      if (reduceMotion) return;
      node.animate(
        [
          { opacity: 0, transform: 'translateY(-8px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        { duration: 240, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
      );
      return;
    }

    const offset = (previousOrder.current - order) * rowHeight;
    previousOrder.current = order;
    if (reduceMotion || offset === 0) return;

    node.animate(
      [
        { transform: `translateY(${String(offset)}px)` },
        { transform: 'translateY(0)' },
      ],
      {
        duration: 280,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      }
    );
  }, [order, reduceMotion, rowHeight]);

  return (
    <div ref={element} className={className}>
      {children}
    </div>
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

export function StatePulseDot({
  motionKey,
  className,
}: {
  readonly motionKey: React.Key;
  readonly className?: string;
}): React.ReactElement {
  const reduceMotion = usePrefersReducedMotion();
  const pulse = React.useRef<HTMLSpanElement>(null);
  const previousKey = React.useRef(motionKey);

  React.useEffect(() => {
    const changed = !Object.is(previousKey.current, motionKey);
    previousKey.current = motionKey;
    if (!changed || reduceMotion || !pulse.current) return;

    pulse.current.animate(
      [
        { opacity: 0.55, transform: 'scale(0.75)' },
        { opacity: 0, transform: 'scale(2.2)' },
      ],
      { duration: 620, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
    );
  }, [motionKey, reduceMotion]);

  return (
    <span className={cn('relative inline-flex size-2.5 shrink-0 text-muted-foreground', className)}>
      <span ref={pulse} className="absolute inset-0 rounded-full border border-current opacity-0" />
      <span className="relative size-full rounded-full bg-current" />
    </span>
  );
}
