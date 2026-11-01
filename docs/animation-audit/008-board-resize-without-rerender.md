# 008 — Resize the board without re-rendering every pointer move

- **Status**: TODO
- **Commit**: f2be41b
- **Severity**: MEDIUM
- **Category**: Performance (found in the `animation-performance` pass)
- **Estimated scope**: 2 files, ~40 lines, plus a test

## Problem

Dragging the board resizer calls React state on every `pointermove`:

```tsx
// web-app/src/features/draft-room/DraftWorkspace.tsx:142-146 — current
onPointerMove={(event) => {
  const drag = dragRef.current;
  if (!drag || drag.pointerId !== event.pointerId) return;
  setBoardHeight(clampBoardHeight(drag.startHeight + event.clientY - drag.startY, drag.maxHeight));
}}
```

Each move does three expensive things:

1. **React re-renders per frame.** `DraftWorkspace` re-renders, then `DraftBoard` (not memoized, `features/draft-room/DraftBoard.tsx:343`) re-renders every pick cell, then the dock re-renders too.
2. **An inherited CSS variable changes on a large subtree.** `DraftBoard.tsx:521` writes `--draft-board-height` on the `.draft-board` section. Only `.board-scroll` (`draft-board.css:39`) reads it, but every descendant of the section gets a style recalculation.
3. **The scroll-follow effect re-runs.** `boardHeight` is in the dependency list of the active-slot scroll effect (`DraftBoard.tsx:446-486`), so each move calls `getBoundingClientRect` and a smooth `scrollTo`.

These causes are verified from code. Whether frames visibly drop needs a recording on a real device.

## Target

During a drag, write the height directly to the DOM. Commit React state once, on `pointerup`/`pointercancel` (as `endDrag` already does).

```tsx
// target sketch, DraftWorkspace.tsx
onPointerMove={(event) => {
  const drag = dragRef.current;
  if (!drag || drag.pointerId !== event.pointerId) return;
  const next = clampBoardHeight(drag.startHeight + event.clientY - drag.startY, drag.maxHeight);
  drag.latestHeight = next;
  stackRef.current?.querySelectorAll<HTMLElement>('.board-scroll')
    .forEach((element) => { element.style.height = `${String(next)}px`; });
}}
// endDrag: commitHeight(drag.latestHeight ?? …), then clear the inline heights so the
// committed --draft-board-height takes over again.
```

Move `--draft-board-height` from the `.draft-board` section to the `.board-scroll` elements (`DraftBoard.tsx:197`). A later variable change then recalculates only those elements.

## Repo conventions to follow

- Layout helpers live in `features/draft-room/draft-workspace-layout.ts`, with tests in `draft-workspace-layout.test.ts`.
- Keep `aria-valuenow`/`aria-valuetext` correct. Update them at commit time, or set them directly on the separator element during the drag.

## Steps

1. Add `latestHeight?: number` to `DragState` in `DraftWorkspace.tsx`.
2. Replace the `onPointerMove` body as in Target.
3. In `endDrag`, commit `drag.latestHeight`, then remove the inline `style.height` from `.board-scroll` elements.
4. In `DraftBoard.tsx`, move the `--draft-board-height` style from the section (`:521`) to each `.board-scroll` element (`:197`).
5. Add a test that fires several `pointermove` events and asserts `DraftBoard` renders once on `pointerup`, not once per move.

## Boundaries

- Do NOT change resize bounds, keyboard resizing, or storage.
- Do NOT add `will-change`.
- STOP and report on drift.

## Verification

- **Mechanical**: `pnpm --filter web-app typecheck && pnpm --filter web-app lint && pnpm --filter web-app test` pass.
- **Feel check**:
  - Drag the resizer quickly on a 12-team board, and record a Performance trace with 4× CPU throttling.
  - Confirm no React commits during the drag, only on release.
  - Confirm the board edge tracks the pointer with no lag, and the active slot stays in view after release.
- **Done when**: the trace shows zero React renders and no long tasks during a drag.
