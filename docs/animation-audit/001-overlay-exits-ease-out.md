# 001 — Overlay exits use ease-out

- **Status**: TODO
- **Commit**: e655db6
- **Severity**: HIGH
- **Category**: Easing & duration
- **Estimated scope**: 1 file, 4 lines

## Problem

Every overlay exit uses `ease-in`. That curve starts slowly, so for the first part of the 100–150ms exit the overlay barely moves. The user has already dismissed it and is watching it go, so the exit reads as lag. These overlays are tooltips, metric popovers, the session popover, dialogs, and the connection sheet.

```css
/* web-app/src/index.css:22-24 — current */
.metric-help-overlay[data-state="closed"] {
  animation: metric-help-exit 100ms ease-in;
}

/* web-app/src/index.css:46-48 — current */
.dialog-overlay[data-state="closed"] {
  animation: dialog-fade-out var(--motion-duration-exit) ease-in both;
}

/* web-app/src/index.css:54-56 — current */
.dialog-content[data-state="closed"] {
  animation: dialog-content-exit var(--motion-duration-exit) ease-in both;
}

/* web-app/src/index.css:62-64 — current */
.dialog-content.dialog-sheet-right[data-state="closed"] {
  animation: dialog-sheet-exit var(--motion-duration-feedback) ease-in both;
}
```

## Target

Exits use the same strong ease-out as entrances. Durations stay exactly as they are.

```css
.metric-help-overlay[data-state="closed"] {
  animation: metric-help-exit var(--motion-duration-exit) var(--motion-ease-out);
}
.dialog-overlay[data-state="closed"] {
  animation: dialog-fade-out var(--motion-duration-exit) var(--motion-ease-out) both;
}
.dialog-content[data-state="closed"] {
  animation: dialog-content-exit var(--motion-duration-exit) var(--motion-ease-out) both;
}
.dialog-content.dialog-sheet-right[data-state="closed"] {
  animation: dialog-sheet-exit var(--motion-duration-feedback) var(--motion-ease-out) both;
}
```

`--motion-duration-exit` is `100ms`, so the tooltip exit keeps its current duration.

## Repo conventions to follow

- Tokens are defined in `web-app/src/design-tokens.css`, which is generated from `docs/design-system/tokens.json`. This plan uses only existing tokens and does not regenerate anything.
- Exemplar: the entrance rule `web-app/src/index.css:42-44` (`animation: dialog-fade-in var(--motion-duration-content) var(--motion-ease-out) both;`).

## Steps

1. In `web-app/src/index.css`, replace `100ms ease-in` with `var(--motion-duration-exit) var(--motion-ease-out)` in `.metric-help-overlay[data-state="closed"]`.
2. In the same file, replace `ease-in both` with `var(--motion-ease-out) both` in `.dialog-overlay[data-state="closed"]`, `.dialog-content[data-state="closed"]`, and `.dialog-content.dialog-sheet-right[data-state="closed"]`.
3. Confirm `grep -n "ease-in" web-app/src/index.css` returns nothing.

## Boundaries

- Do NOT change durations, keyframes, or entrance rules.
- Do NOT touch `.metric-help-overlay[data-state="instant-open"]`.
- Do NOT add tokens.
- If the rules above don't match the file (drift since `e655db6`), STOP and report.

## Verification

- **Mechanical**: `pnpm --filter web-app typecheck && pnpm --filter web-app lint && pnpm --filter web-app test` all pass.
- **Feel check**: open the League setup dialog, the connection sheet, and a metric help popover, then dismiss each.
  - The overlay starts leaving the instant you dismiss it. It should not hang for a beat and then drop away.
  - In DevTools, set the Animations panel playback to 10% and confirm the exit's motion is front-loaded.
  - Radix still unmounts the overlay when the exit ends. Nothing stays on screen or blocks clicks.
- **Done when**: `index.css` has no `ease-in`, and all four exits reference `var(--motion-ease-out)`.
