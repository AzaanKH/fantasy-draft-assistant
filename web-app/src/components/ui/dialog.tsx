import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>): React.ReactElement {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

// Wrappers forward refs: a Tooltip or Popover trigger with asChild hands its Slot ref to them (React 18).
const DialogTrigger = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Trigger>
>(function DialogTrigger(props, ref) {
  return <DialogPrimitive.Trigger ref={ref} data-slot="dialog-trigger" {...props} />
})

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>): React.ReactElement {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(function DialogOverlay({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      data-slot="dialog-overlay"
      className={cn(
        "dialog-overlay fixed inset-0 z-50 bg-black/50",
        className
      )}
      {...props}
    />
  )
})

/** Where focus goes when the control that opened a dialog is gone: its list, panel or the page's main region. */
const FOCUS_RETURN_FALLBACK = '[data-focus-return], [data-suggestion-list], [role="tabpanel"], [role="dialog"], main'

/**
 * Where focus goes when a dialog closes: the control that opened it while it is still on the page and enabled, else
 * the region it sat in (its list, tab panel or dialog), else the page's main region. The modal's own aria-hidden or
 * inert on the page is still set at that moment, so only a removed or hidden element counts as gone.
 */
export function getFocusReturnTarget({ opener, fallback }: { readonly opener: HTMLElement | null; readonly fallback: HTMLElement | null }): HTMLElement | null {
  const usable = (element: HTMLElement | null): element is HTMLElement => element !== null && element.isConnected && element.closest("[hidden]") === null
  if (usable(opener) && !(opener instanceof HTMLButtonElement && opener.disabled)) return opener
  if (usable(fallback)) return fallback
  return document.querySelector<HTMLElement>("main")
}

/**
 * The element that had focus when a dialog opened, and the nearest region to fall back to. Read when Radix is about to
 * move focus inside (onOpenAutoFocus), so a dialog opened from state (no DialogTrigger) still knows its opener.
 */
function useFocusReturn(): { readonly onOpen: () => void; readonly onClose: (event: Event) => void } {
  const origin = React.useRef<{ opener: HTMLElement | null; fallback: HTMLElement | null }>({ opener: null, fallback: null })
  const onOpen = React.useCallback(() => {
    const active = document.activeElement
    const opener = active instanceof HTMLElement && active !== document.body ? active : null
    origin.current = { opener, fallback: opener?.parentElement?.closest<HTMLElement>(FOCUS_RETURN_FALLBACK) ?? null }
  }, [])
  const onClose = React.useCallback((event: Event) => {
    if (event.defaultPrevented) return
    const target = getFocusReturnTarget(origin.current)
    if (!target) return
    event.preventDefault()
    if (target !== origin.current.opener && !target.hasAttribute("tabindex")) target.tabIndex = -1
    target.focus({ preventScroll: true })
  }, [])
  return { onOpen, onClose }
}

/**
 * Dialog shell. By default the frame is bounded to the viewport and children
 * render in an internally scrolling body, so long content never pushes the
 * header or close button off short laptop screens. Layouts that manage their
 * own scrolling (e.g. a full-height sheet) pass `scrollable={false}`.
 */
const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    showCloseButton?: boolean
    scrollable?: boolean
    bodyClassName?: string
  }
>(function DialogContent({
  className,
  bodyClassName,
  children,
  showCloseButton = true,
  scrollable = true,
  onCloseAutoFocus,
  onOpenAutoFocus,
  ...props
}, ref) {
  // Focus returns to the control that opened the dialog, or a sensible region if that control has gone, also for
  // dialogs opened from state rather than a DialogTrigger. A caller that moves focus itself prevents the default.
  const returnFocus = useFocusReturn()
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        data-slot="dialog-content"
        className={cn(
          "dialog-content bg-background text-foreground fixed top-[50%] left-[50%] z-50 w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] rounded-lg border shadow-lg outline-none sm:max-w-lg",
          scrollable
            ? "flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden"
            : "grid gap-4 p-6",
          className
        )}
        {...props}
        onOpenAutoFocus={(event) => {
          returnFocus.onOpen()
          onOpenAutoFocus?.(event)
        }}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event)
          returnFocus.onClose(event)
        }}
      >
        {scrollable ? (
          <div
            data-slot="dialog-body"
            className={cn("grid min-h-0 flex-1 gap-4 overflow-y-auto overscroll-contain p-6", bodyClassName)}
          >
            {children}
          </div>
        ) : children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground bg-background absolute top-2 right-2 z-10 inline-flex size-8 items-center justify-center rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
})

const DialogHeader = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<"div">>(function DialogHeader({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
})

const DialogFooter = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<"div">>(function DialogFooter({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  )
})

const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function DialogTitle({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  )
})

const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function DialogDescription({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Description
      ref={ref}
      data-slot="dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
})

export {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
}
