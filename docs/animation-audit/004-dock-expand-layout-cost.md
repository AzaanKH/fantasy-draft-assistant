# 004 — Measure the dock expand layout cost

- **Status**: DEFERRED
- **Commit**: e655db6
- **Severity**: MEDIUM
- **Category**: Performance
- **Estimated scope**: measure first; if needed, 1 file, ~10 lines

## Problem

`MotionExpandable` animates a layout property:

```css
/* web-app/src/index.css:97-116 — current */
.motion-expandable-grid {
  display: grid;
  grid-template-rows: 1fr;
  opacity: 1;
  transition:
    grid-template-rows var(--motion-duration-layout) var(--motion-ease-out),
    opacity var(--motion-duration-content) var(--motion-ease-out),
    transform var(--motion-duration-layout) var(--motion-ease-out);
}
.motion-expandable-grid[data-state="closed"] {
  grid-template-rows: 0fr;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-4px);
}
```

In `web-app/src/features/draft-room/DraftDock.tsx:102-135`, it wraps the whole player pool (a virtualized list in a `clamp(360px, 48vh, 640px)` scroller) and the roster, queue, and suggestions panels. For 280ms, each frame re-lays out the grid track, the dock, and everything after it. On a fast laptop this is likely invisible. On a mid-range phone, or with the board and pool both mounted, it may drop frames. That cannot be determined from code.

`DraftConnect.tsx:478` (the optional-signals list) uses the same wrapper. That list is small and rare, so it is out of scope.

## Target

1. **Measure.** Record a DevTools Performance trace while collapsing and expanding the dock, at 4× CPU throttling and on a real mid-range Android device over remote debugging. If every frame lands inside 16.7ms (8ms on 120Hz), mark this plan WONTFIX with the trace numbers and stop.
2. **Only if frames drop**, give the dock its own expandable variant. It fades and lifts with composite-only properties, and the height change happens once at the start (expand) or end (collapse):

```css
/* target, only if measurement shows dropped frames */
.motion-expandable-grid.is-composite-only {
  transition:
    opacity var(--motion-duration-content) var(--motion-ease-out),
    transform var(--motion-duration-content) var(--motion-ease-out),
    grid-template-rows 0s linear var(--motion-duration-content);
}
.motion-expandable-grid.is-composite-only[data-state="open"] {
  transition:
    opacity var(--motion-duration-content) var(--motion-ease-out),
    transform var(--motion-duration-content) var(--motion-ease-out),
    grid-template-rows 0s;
}
```

Pass `className="is-composite-only"` to the three `MotionExpandable` uses in `DraftDock.tsx`.

## Repo conventions to follow

- `MotionExpandable` (`web-app/src/components/motion.tsx:198-227`) already merges `className` through `cn()`. No component change is needed.

## Steps

1. Record the traces described in Target step 1. Attach the frame timings to this plan.
2. If there is no jank, set Status to WONTFIX with the evidence and stop.
3. Otherwise, add the CSS from Target to `web-app/src/index.css` below `.motion-expandable-content`.
4. Add `className="is-composite-only"` to `<MotionExpandable open={isExpanded}>` at `DraftDock.tsx:102`, `:114`, and `:130`.

## Boundaries

- Do NOT change `DraftConnect.tsx`.
- Do NOT change `MotionExpandable`'s inert or `aria-hidden` handling.
- Do NOT add `will-change`.
- STOP and report on drift.

## Verification

- **Mechanical**: `pnpm --filter web-app typecheck && pnpm --filter web-app lint && pnpm --filter web-app test` pass.
- **Feel check**:
  - Collapse and expand the dock repeatedly, and confirm no frames drop in the Performance panel.
  - Confirm content below the dock jumps once rather than sliding. If that jump feels worse than the current glide, revert. The jump is the trade-off, so it needs a human call.
  - Spam the toggle and confirm the transition retargets rather than restarting.
- **Done when**: a trace shows no dropped frames during dock expand/collapse on the target device.

## Outcome

Deferred on `chore/animation-pass`; no code changed. This pass had no browser or device, so Target step 1 (the trace) could not run. The only alternative here, the `is-composite-only` variant, is not visually identical. It replaces the 280ms height glide of the dock and everything below it with a single jump, and Verification already calls that trade-off a human decision. No change could make this strictly cheaper while looking the same, because the height has to be re-laid out every frame for the content below to slide.

Plan 003 changed what happens under reduced motion: the dock now fades and the height changes at once. That variant can serve as a feel reference for the composite-only option.

Next step: record the trace (4× CPU throttling plus a mid-range Android device). If frames drop, apply Target step 2 and get a human call on the jump.
