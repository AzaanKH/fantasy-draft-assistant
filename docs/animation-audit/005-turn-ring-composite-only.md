# 005 — Turn ring animates composite-only properties

- **Status**: DONE
- **Commit**: e655db6
- **Severity**: LOW
- **Category**: Performance
- **Estimated scope**: 2 files, ~20 lines

## Problem

When the user's turn starts, the clock chip pulses a ring by animating `box-shadow`. That property is paint-tier, so it repaints the chip on every frame for 600ms. It also uses the built-in `ease-out` instead of the repo's curve.

```tsx
// web-app/src/features/draft-room/DraftBoard.tsx:491-501 — current
React.useEffect(() => {
  const justStarted = isYourTurn && !previouslyYourTurn.current;
  previouslyYourTurn.current = isYourTurn;
  if (!justStarted || reduceMotion || !turnIndicatorRef.current) return;
  const animation = turnIndicatorRef.current.animate([
    { boxShadow: '0 0 0 0 rgba(253, 224, 71, 0.6)' },
    { boxShadow: '0 0 0 10px rgba(253, 224, 71, 0)' },
  ], { duration: 600, easing: 'ease-out' });
  return () => { animation.cancel(); };
}, [isYourTurn, reduceMotion]);
```

The chip is small and this fires about 15 times a draft, so the real cost is low. A cheaper property gives the same visual, though, so the skill's rule applies.

## Target

A ring pseudo-element whose `transform` and `opacity` animate through WAAPI's `pseudoElement` option:

```css
/* web-app/src/features/draft-room/draft-board.css, next to .board-current-pick */
.board-current-pick { position: relative; }
.board-current-pick::after {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow: 0 0 0 2px rgba(253, 224, 71, 0.6);
  opacity: 0;
  pointer-events: none;
  content: "";
}
```

```tsx
// target
const animation = turnIndicatorRef.current.animate([
  { opacity: 1, transform: 'scale(1)' },
  { opacity: 0, transform: 'scale(1.25)' },
], { duration: 600, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', pseudoElement: '::after' });
```

## Repo conventions to follow

- Board styles live in `web-app/src/features/draft-room/draft-board.css`. `.board-current-pick` is at line 36.
- The repo's curve is `cubic-bezier(0.22, 1, 0.36, 1)` (`--motion-ease-out`).

## Steps

1. Add the CSS from Target to `draft-board.css` after line 38. Check `.board-current-pick` isn't already positioned. If it is, skip `position: relative`.
2. Replace the keyframes and options in `DraftBoard.tsx:496-499` with the Target call.
3. Keep the `reduceMotion` guard and the `animation.cancel()` cleanup.

## Boundaries

- Do NOT change when the ring fires.
- Do NOT add `will-change`.
- STOP and report on drift.

## Verification

- **Mechanical**: `pnpm --filter web-app typecheck && pnpm --filter web-app lint && pnpm --filter web-app test` pass.
- **Feel check**:
  - In a mock draft, wait for your turn and confirm one yellow ring expands and fades around the "On the clock" chip.
  - Confirm the Performance panel shows no paint on the chip during the pulse.
  - Compare against the old ring at 10% playback. The new ring is a scaled outline, not a growing spread, so confirm it still reads as an alert.
- **Done when**: the pulse animates only `transform` and `opacity`.

## Outcome

- `web-app/src/features/draft-room/draft-board.css` adds `position: relative` to `.board-current-pick` (it was not positioned) and a static `::after` ring that rests at `opacity: 0`.
- `web-app/src/features/draft-room/DraftBoard.tsx` animates that pseudo-element's `opacity` and `transform` (`scale(1)` → `scale(1.25)`) over 600ms with `MOTION_EASE_CSS` from `components/motion.tsx`, using WAAPI's `pseudoElement: '::after'` option. The `reduceMotion` guard, the turn-start trigger, and the `cancel()` cleanup are unchanged.
- No test was added: asserting the keyframe arguments would only restate the implementation. Typecheck, lint, and tests pass.
- Needs a human look. The ring scales with the chip's shape, so on a wide chip it grows about 20px sideways but only about 4px vertically. The old ring spread 10px evenly on every side. Check that it still reads as an alert.
