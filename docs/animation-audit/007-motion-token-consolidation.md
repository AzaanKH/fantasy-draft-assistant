# 007 — Consolidate motion tokens

- **Status**: DONE
- **Commit**: e655db6
- **Severity**: LOW
- **Category**: Cohesion & tokens
- **Estimated scope**: 3 files, ~25 lines

## Problem

The curve and durations are typed by hand in several places:

```tsx
// web-app/src/components/motion.tsx — current
const MOTION_EASE = [0.22, 1, 0.36, 1] as const;                 // :6
const CONTENT_TRANSITION = { duration: 0.21, ease: MOTION_EASE }; // :7
easing: 'cubic-bezier(0.22, 1, 0.36, 1)',                         // :70
const SWAP_TRANSITION = { duration: 0.15, ease: MOTION_EASE };   // :98
exit={... { opacity: 0, transition: { duration: 0.08 } }}         // :121
transition={... { layout: { duration: 0.25, ease: MOTION_EASE } }} // :193
useChangeAnimation(element, motionKey, FADE_KEYFRAMES, 180);      // MotionFade
```

```css
/* web-app/src/draft-design.css — keyword ease-out with literal durations */
.depth-count-button { … transition: background-color 140ms ease-out; }        /* :181 */
.depth-player-detail { … animation: depth-detail-enter 180ms ease-out; }      /* :189 */
.draft-position-filter { … transition: background-color 140ms ease-out, color 140ms ease-out; } /* :283 */
.draft-pool-row { … transition: background-color 140ms ease-out; }            /* :300 */
.draft-workspace-resizer::before { … transition: background-color 120ms ease-out; } /* :379 */
.draft-workspace-resizer-grip { … transition: background-color 120ms ease-out; }   /* :380 */

/* web-app/src/index.css:193 */
animation: draft-pick-highlight 250ms ease-out both;
```

The curves nearly match, but a change to `--motion-ease-out` would not reach any of them.

## Target

- `motion.tsx` reads from one constants block that mirrors the CSS tokens:

```tsx
/** Mirrors --motion-* in design-tokens.css (generated from docs/design-system/tokens.json). */
const MOTION_EASE = [0.22, 1, 0.36, 1] as const;
const MOTION_EASE_CSS = `cubic-bezier(${MOTION_EASE.join(', ')})`;
const MOTION_MS = { feedback: 150, content: 210, layout: 280, exit: 100 } as const;
```

  Use `MOTION_EASE_CSS` at `:70`. Use `MOTION_MS.content / 1000` in `CONTENT_TRANSITION`, `MOTION_MS.feedback / 1000` in `SWAP_TRANSITION`, `MOTION_MS.layout / 1000` for the reorder layout, `MOTION_MS.exit / 1000` for the swap exit (80ms → 100ms), and `MOTION_MS.feedback` for `MotionFade` (180ms → 150ms).
- Color-only hover transitions in `draft-design.css` become `var(--motion-duration-feedback) ease`. The AUDIT says hover and color changes use `ease`.
- `.depth-player-detail` and the new-pick highlight become `var(--motion-ease-out)` with token durations (`--motion-duration-feedback` for the 180ms fade; keep `250ms` for the highlight).

## Repo conventions to follow

- CSS tokens come from `docs/design-system/tokens.json` via `pnpm tokens:write`. This plan adds none.

## Steps

1. Add the constants block at the top of `web-app/src/components/motion.tsx` and replace each literal listed in Problem.
2. In `web-app/src/draft-design.css`, change lines 181, 283, 300, 379, and 380 to `var(--motion-duration-feedback) ease`.
3. Change line 189 to `animation: depth-detail-enter var(--motion-duration-feedback) var(--motion-ease-out);`.
4. Change `web-app/src/index.css:193` to `animation: draft-pick-highlight 250ms var(--motion-ease-out) both;`.

## Boundaries

- Do NOT change which elements animate.
- The only intended duration changes are 80→100ms (swap exit), 180→150ms (MotionFade, depth detail), and 120/140→150ms (hovers).
- STOP and report on drift.

## Verification

- **Mechanical**: `pnpm --filter web-app typecheck && pnpm --filter web-app lint && pnpm --filter web-app test` pass. `grep -n "0.22, 1, 0.36, 1" web-app/src/components/motion.tsx` returns exactly one line.
- **Feel check**:
  - Hover pool rows and position filters and confirm the color still eases in quickly.
  - Confirm the best-pick fade in the Best Pick bar doesn't feel slower.
- **Done when**: no hand-typed curve remains outside the constants block and the token file.

## Outcome

Applied on `chore/animation-pass`, before plans 002–006 so they could use the shared values.

- `web-app/src/components/motion.tsx` has one constants block (`MOTION_EASE`, exported `MOTION_EASE_CSS` and `MOTION_MS`). Every transition and the WAAPI fade read from it. The curve literal appears once.
- Duration changes: swap exit 80→100ms, `MotionFade` 180→150ms, depth detail 180→150ms, hovers 120/140→150ms. The reorder layout moved 250→280ms (`MOTION_MS.layout`), as Step 1 asks. The Boundaries list omitted that change; it is 30ms on queue reorders and keeps the token single-sourced.
- Hover color transitions in `draft-design.css` use `var(--motion-duration-feedback) ease`. The depth detail and new-pick highlight use `var(--motion-ease-out)`.
- New test `web-app/src/components/motion-tokens.test.ts` fails if `MOTION_MS` or `MOTION_EASE_CSS` drifts from `design-tokens.css`.
