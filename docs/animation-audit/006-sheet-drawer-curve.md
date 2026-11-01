# 006 — Sheet uses the drawer curve

- **Status**: DONE
- **Commit**: e655db6
- **Severity**: LOW
- **Category**: Easing & duration
- **Estimated scope**: 3 files (token JSON, generated CSS, index.css)

## Problem

The right-hand connection sheet (`DraftConnect.tsx:1057`) slides in with the generic UI ease-out:

```css
/* web-app/src/index.css:58-64 — current */
.dialog-content.dialog-sheet-right[data-state="open"] {
  animation: dialog-sheet-enter var(--motion-duration-layout) var(--motion-ease-out) both;
}
.dialog-content.dialog-sheet-right[data-state="closed"] {
  animation: dialog-sheet-exit var(--motion-duration-feedback) ease-in both;
}
```

A full-height panel travelling 440px reads better with the iOS-like drawer curve. It decelerates longer, so the panel settles rather than stops.

## Target

```css
/* new token */
--motion-ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);

/* index.css */
.dialog-content.dialog-sheet-right[data-state="open"] {
  animation: dialog-sheet-enter var(--motion-duration-layout) var(--motion-ease-drawer) both;
}
.dialog-content.dialog-sheet-right[data-state="closed"] {
  animation: dialog-sheet-exit var(--motion-duration-feedback) var(--motion-ease-drawer) both;
}
```

## Repo conventions to follow

- `web-app/src/design-tokens.css` is generated. Add the token to `docs/design-system/tokens.json` next to `--motion-ease-out` (around line 472), then run `pnpm tokens:write`. `scripts/design-tokens.test.mjs` checks parity.

## Steps

1. Add `"--motion-ease-drawer": "cubic-bezier(0.32, 0.72, 0, 1)"` after `--motion-ease-out` in `docs/design-system/tokens.json`.
2. Run `pnpm tokens:write`. Confirm `web-app/src/design-tokens.css` gains the line, and update `docs/design-system/tokens.css` if the script does.
3. Update the two sheet rules in `web-app/src/index.css` to the Target.

## Boundaries

- Do NOT change durations or other dialogs.
- STOP and report on drift.

## Verification

- **Mechanical**: `pnpm test` (includes `scripts/design-tokens.test.mjs`) and `pnpm --filter web-app lint` pass.
- **Feel check**:
  - Open and close the connection sheet. It should arrive quickly and ease into place without a hard stop.
  - At 10% playback, confirm most of the travel happens in the first third.
- **Done when**: both sheet rules reference `--motion-ease-drawer`, and the token is generated from JSON.

## Outcome

- `docs/design-system/tokens.json` gains `--motion-ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)` after `--motion-ease-out`. `pnpm tokens:write` regenerated `web-app/src/design-tokens.css`. `docs/design-system/tokens.css` did not change, because the motion block is only emitted to the web-app output.
- Both `.dialog-sheet-right` rules in `web-app/src/index.css` use `var(--motion-ease-drawer)`. Durations are unchanged.
- `pnpm tokens:check` and `scripts/design-tokens.test.mjs` pass. Not checked in a browser.
