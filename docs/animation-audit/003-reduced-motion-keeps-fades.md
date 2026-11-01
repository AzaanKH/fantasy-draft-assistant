# 003 — Reduced motion keeps fades

- **Status**: DONE
- **Commit**: e655db6
- **Severity**: MEDIUM
- **Category**: Accessibility
- **Estimated scope**: 2 files, ~30 lines

## Problem

Reduced motion currently means *no* motion. Every animation and transition drops to 0ms:

```css
/* web-app/src/index.css:196-205 — current */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    animation-duration: var(--motion-duration-instant) !important;
    animation-iteration-count: 1 !important;
    transition-duration: var(--motion-duration-instant) !important;
  }
}
```

```tsx
// web-app/src/components/motion.tsx:18-21 — current
<MotionConfig
  reducedMotion={reduceMotion ? 'always' : 'never'}
  transition={reduceMotion ? { duration: 0 } : CONTENT_TRANSITION}
>
```

Each wrapper also branches to `initial={false}` / `{ duration: 0 }` (`motion.tsx:119-122`), and `useChangeAnimation` returns early (`motion.tsx:66`). Dialogs, popovers, best-pick swaps, and color feedback snap in. Reduced motion should remove *movement* (translate, scale, layout) while keeping the opacity and color changes that tell the user something changed.

## Target

- CSS: under reduced motion, overlay and dialog keyframes become opacity-only, and the sheet becomes a fade. Color transitions keep their durations. The global rule is limited to scroll behavior and infinite loops.
- Motion: `MotionConfig reducedMotion="user"` (Motion drops transform/layout and keeps opacity). Swaps keep their opacity fade. `useChangeAnimation` still runs its opacity-only keyframes.

```css
/* target, web-app/src/index.css */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    animation-iteration-count: 1 !important;
  }
  .metric-help-overlay { animation-name: dialog-fade-in; }
  .metric-help-overlay[data-state="closed"] { animation-name: dialog-fade-out; }
  .dialog-content[data-state="open"],
  .dialog-content.dialog-sheet-right[data-state="open"] { animation-name: dialog-fade-in; }
  .dialog-content[data-state="closed"],
  .dialog-content.dialog-sheet-right[data-state="closed"] { animation-name: dialog-fade-out; }
  .motion-expandable-grid { transition-property: opacity; }
  .motion-expandable-grid[data-state="closed"] { transform: none; }
  [data-slot=button]:active:not(:disabled) { transform: none; }
}
```

```tsx
// target, web-app/src/components/motion.tsx
<MotionConfig reducedMotion="user" transition={CONTENT_TRANSITION}>
// MotionSwapContent: always pass initial={{ opacity: 0 }} and SWAP_TRANSITION (opacity-only already).
// MotionReorderItem: keep layout={reduceMotion ? false : 'position'}.
// useChangeAnimation: skip only when isMotionDisabled(); keyframes passed in are opacity-only (FADE_KEYFRAMES).
```

## Repo conventions to follow

- `isMotionDisabled()` (`motion.tsx:34-37`) and `html[data-visual-test]` (`index.css:207-213`) must keep disabling *everything* for visual fixtures. Do not change them.
- `.motion-expandable-grid[data-reduced-motion="true"] { transition: none; }` (`index.css:119-121`) becomes `transition-property: opacity;`.

## Steps

1. Replace the reduced-motion block in `web-app/src/index.css` with the Target CSS.
2. Change `.motion-expandable-grid[data-reduced-motion="true"]` to `transition-property: opacity;`.
3. In `web-app/src/components/motion.tsx`, set `MotionConfig` as in Target. In `MotionSwapContent`, drop the `reduceMotion` branches for `initial`, `exit`, and `transition`. In `useChangeAnimation`, replace `reduceMotion` with `isMotionDisabled()` in the early return.
4. Keep `MotionReorderItem`'s `layout={reduceMotion ? false : 'position'}`.
5. Check `DraftBoard.tsx:495` (the turn ring). It is movement, so keep its reduced-motion skip.

## Boundaries

- Do NOT change normal-motion durations or curves.
- Do NOT remove the `data-visual-test` override.
- Do NOT add dependencies.
- STOP and report on drift.

## Verification

- **Mechanical**: `pnpm --filter web-app typecheck && pnpm --filter web-app lint && pnpm --filter web-app test` pass. Run `pnpm test` at the root as well, because the visual fixtures use `data-visual-test`.
- **Feel check**: in DevTools Rendering, emulate `prefers-reduced-motion: reduce`.
  - Dialogs, the sheet, and popovers fade with no scale or slide.
  - Best-pick swaps in the side panel still fade.
  - The dock collapses with a fade, not a slide.
  - Queue rows do not glide.
  - Button press does not scale.
- **Done when**: reduced motion shows opacity and color feedback with zero translate, scale, or layout movement.

## Outcome

Implemented with these deviations from Target, found while doing it:

- **Visual fixtures stay frozen.** `html[data-visual-test]` only stops CSS animations. Motion and WAAPI animations need their own check, so `MotionSwapContent` and `useChangeAnimation` skip on `isMotionDisabled()`. `MotionProvider` keeps `reducedMotion` driven by `usePrefersReducedMotion()` (`always`/`never`), which equals `"user"` but also covers visual fixtures. Its default transition is `{ duration: 0 }` only when motion is disabled.
- **Expandable fade uses the full shorthand.** `transition-property: opacity` alone would pair opacity with the first listed duration (`layout`, 280ms). Both the media-query rule and `[data-reduced-motion="true"]` use `transition: opacity var(--motion-duration-content) var(--motion-ease-out)` instead.
- **No button rule.** The press scale is already inside `@media (prefers-reduced-motion: no-preference)`, so `[data-slot=button]:active { transform: none; }` would do nothing.
- **Two additions.** The old 0ms override had also stopped spinners and the details-chevron rotation. Without it, `animate-spin` would spin once (iteration count 1) and `transition-transform` would rotate. The block now sets `.animate-spin { animation: none; }` and `.transition-transform { transition-property: none; }`.
- Sonner already disables its own motion under reduced motion. The turn ring and the board's auto-scroll keep their reduced-motion skips.

Tests added in `web-app/src/components/motion.test.tsx`: `MotionFade` still runs its opacity keyframes under `prefers-reduced-motion: reduce`, and runs nothing under `data-visual-test`. Not checked in a browser.
