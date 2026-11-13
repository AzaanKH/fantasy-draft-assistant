import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '@/lib/utils';

export function TooltipProvider({
  delayDuration = 400,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>): React.ReactElement {
  return <TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />;
}

export const Tooltip = TooltipPrimitive.Root;

/** Keys that open a menu from its focused trigger. */
const MENU_OPEN_KEYS = new Set(['Enter', ' ', 'ArrowDown', 'ArrowUp']);

/**
 * A tooltip trigger that does not reopen when focus comes back to it from a menu it opened: the menu returns focus
 * when it closes, and a tooltip popping up then would sit over the controls the user is moving to (R8-2: it covered
 * Full board after an Appearance choice). A pointer press on a menu trigger never focuses it (Radix prevents that),
 * so the press itself, a menu-opening key, or focus leaving while expanded marks the next focus as the return.
 */
export const TooltipTrigger = React.forwardRef<
  React.ComponentRef<typeof TooltipPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Trigger>
>(function TooltipTrigger({ onBlur, onFocus, onPointerDown, onKeyDown, ...props }, ref) {
  const returning = React.useRef(false);
  const opensMenu = (element: Element): boolean => element.getAttribute('aria-haspopup') === 'menu';
  return (
    <TooltipPrimitive.Trigger
      ref={ref}
      {...props}
      onPointerDown={(event) => {
        if (opensMenu(event.currentTarget)) returning.current = true;
        onPointerDown?.(event);
      }}
      onKeyDown={(event) => {
        if (opensMenu(event.currentTarget) && MENU_OPEN_KEYS.has(event.key)) returning.current = true;
        onKeyDown?.(event);
      }}
      onBlur={(event) => {
        // Focus left for the menu this trigger just opened.
        if (event.currentTarget.getAttribute('aria-expanded') === 'true') returning.current = true;
        onBlur?.(event);
      }}
      onFocus={(event) => {
        onFocus?.(event);
        // preventDefault skips Radix's open-on-focus for this one return.
        if (returning.current) { returning.current = false; event.preventDefault(); }
      }}
    />
  );
});

export const TooltipContent = React.forwardRef<
  React.ComponentRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(function TooltipContent({ className, sideOffset = 6, collisionPadding = 12, children, ...props }, ref) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        // Never a pointer target: a tooltip left open over a neighbouring control must not swallow its click.
        className={cn(
          'metric-help-overlay pointer-events-none z-[60] max-w-[min(18rem,var(--radix-tooltip-content-available-width))] rounded-md border border-border bg-popover px-3 py-2 text-xs leading-relaxed text-popover-foreground shadow-md',
          className
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="fill-popover" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
});

/**
 * The one tooltip for icon-only (or label-folding) controls such as the header buttons: the same delay, placement
 * and styling everywhere. The control keeps its own aria-label; the tooltip is the visible name.
 */
export function IconTooltip({ label, children, side = 'bottom' }: {
  readonly label: string;
  readonly children: React.ReactElement;
  readonly side?: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>['side'];
}): React.ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}
