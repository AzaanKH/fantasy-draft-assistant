# Animation audit

- **Commit audited**: `e655db6` (after the "Remove animations that don't earn their place" pass)
- **Scope**: `web-app/` and `extension/`. The extension has no animation code; its side panel renders the web app's `SidePanelPage`.
- **Method**: Emil Kowalski's `improve-animations` skill (recon, eight-category audit, vetting, one plan per finding).

## Recon

| Fact | Value |
| --- | --- |
| Stack | React 18, Vite, Tailwind v4, Radix Dialog/Popover/Tooltip/Tabs, Sonner |
| Motion library | `motion` v13 through `LazyMotion` + `m.*` (`web-app/src/components/motion.tsx`); `domMax` loads lazily for layout measurement |
| Other drivers | CSS keyframes and transitions (`web-app/src/index.css`, `web-app/src/draft-design.css`), WAAPI (`useChangeAnimation` in `motion.tsx`, turn indicator in `DraftBoard.tsx`) |
| Tokens | `--motion-duration-{instant,feedback,content,layout,exit}` and `--motion-ease-out: cubic-bezier(0.22, 1, 0.36, 1)`. `web-app/src/design-tokens.css` is generated from `docs/design-system/tokens.json` by `pnpm tokens:write`. Edit the JSON, then regenerate the CSS. |
| Reduced motion | Global CSS override in `index.css:196-205`, `MotionConfig` in `motion.tsx:18-21`, and per-wrapper `usePrefersReducedMotion()`. `html[data-visual-test]` disables all motion for visual fixtures. |
| Personality | A crisp, data-dense tool used under time pressure during a live draft. Motion should stay quiet and fast. |

### Frequency map

| Frequency | Surfaces |
| --- | --- |
| 100+ per draft | Pool row hover color (`draft-design.css:300`), button press scale (`index.css:171-175`), metric tooltips while sweeping (instant-open is not animated) |
| Tens per draft | Best Pick fade (`DraftDecisionBar.tsx:61`), side panel best-pick swaps (`SidePanelPage.tsx:243`, `:521`), queue row layout movement (`DraftQueuePanel.tsx:63-107`), new-pick highlight (`index.css:181-194`), metric popovers |
| Occasional | Dialogs and the connection sheet (`index.css:41-95`), dock collapse/expand (`DraftDock.tsx:102-135`), the "your turn" ring (`DraftBoard.tsx:491-501`), board auto-scroll |
| Rare | Optional-signals disclosure (`DraftConnect.tsx:478`), depth detail fade (`draft-design.css:189`) |

## Findings

Vetted against the cited code. Ordered by leverage (impact ÷ effort).

| # | Severity | Category | Location | Finding | Fix summary | Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | HIGH | Easing & duration | `web-app/src/index.css:23, 47, 55, 63` | Every overlay exit (tooltip/popover, dialog overlay, dialog content, sheet) uses `ease-in`, which starts slow at the moment the user is watching the overlay leave. | Swap `ease-in` for `var(--motion-ease-out)` on all four exits. | [001](001-overlay-exits-ease-out.md) |
| 2 | MEDIUM | Physicality & origin | `web-app/src/index.css:18-39`, `web-app/src/components/ui/popover.tsx:22` | Tooltips and popovers share one keyframe that always rises from `translateY(3px)`. Tooltips open on top, so they move away from the trigger, which is correct. Popovers open on the bottom by default, so they travel *toward* their trigger. | Pick the entrance offset from Radix `data-side` so the panel always moves away from its trigger. | [002](002-overlay-entrance-follows-side.md) |
| 3 | MEDIUM | Accessibility | `web-app/src/index.css:196-205`, `web-app/src/components/motion.tsx:18-21` | Reduced motion sets every animation and transition to 0ms, including opacity fades and color transitions that aid comprehension. It also zeroes Motion's swap fades. | Keep opacity/color at their normal durations under reduced motion. Drop only movement (translate, scale, layout). | [003](003-reduced-motion-keeps-fades.md) |
| 4 | MEDIUM | Performance | `web-app/src/index.css:97-121`, `web-app/src/features/draft-room/DraftDock.tsx:102-135` | `MotionExpandable` animates `grid-template-rows` for 280ms. In the draft dock this re-lays out the player pool and everything below it on every frame. | Feel-check and measure on a mid-range device before changing it. If frames drop, collapse with a fade plus an instant height change. | [004](004-dock-expand-layout-cost.md) |
| 5 | LOW | Performance | `web-app/src/features/draft-room/DraftBoard.tsx:491-501` | The "your turn" ring animates `box-shadow` (paint every frame) through WAAPI with a built-in `ease-out`. | Animate a ring pseudo-element's `transform` + `opacity` instead. | [005](005-turn-ring-composite-only.md) |
| 6 | LOW | Easing & duration | `web-app/src/index.css:58-64` | The right-hand connection sheet uses the generic UI ease-out rather than a drawer curve. | Add `--motion-ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)` and use it for the sheet's enter and exit. | [006](006-sheet-drawer-curve.md) |
| 7 | LOW | Cohesion & tokens | `web-app/src/components/motion.tsx:6-7, 70, 98, 121, 193`; `web-app/src/draft-design.css:181, 189, 283, 300, 379-380`; `web-app/src/index.css:23, 193` | The easing curve is hand-typed three times in `motion.tsx` (array and string). Durations there are literals rather than tokens. CSS mixes the `--motion-ease-out` token with the keyword `ease-out` and literal 100/120/140/180/250ms. | Read easing and durations from one module that mirrors the CSS tokens. Replace keyword `ease-out` with the token. | [007](007-motion-token-consolidation.md) |

### Considered and rejected

- `transform-origin: center` on `.dialog-content`: modals are exempt.
- Press feedback is missing on non-`Button` pressables (`.rec-icon-button`, `.depth-count-button`, `.draft-position-filter`). These are hit tens of times a draft in a crisp tool. Adding scale there works against restraint, so it is not a finding.
- `DecisionSwap` keeps `AnimatePresence mode="wait"` (80ms exit, then a 150ms fade). The outgoing content is inert and `aria-hidden` (tested in `components/motion.test.tsx`), and the delay is under the swap budget.
- The board's smooth auto-scroll (`DraftBoard.tsx:480-484`) already falls back to `auto` under reduced motion and only moves when the active slot leaves view.
- The new-pick highlight (`index.css:181-194`) fades opacity on a pseudo-element: composite-only, 250ms, `ease-out` keyword (covered by plan 007).
- No file contained instructions aimed at agents.

### Missed opportunities (additive, not planned)

1. **Provisional Pick reconciliation teleports.** When Provider Truth replaces a Provisional Pick with a different player, the slot changes in place with no cue (`DraftBoard.tsx:99-106`). The settle highlight fires only when `latestPickNumber` increases. Reusing `draft-pick-highlight` for corrected slots would show the user what changed.
2. **Draft completion has no moment.** When the last pick lands, the clock chip just turns `is-complete` (`draft-board.css:38`). This is rare, high-emotion, and has room for delight: a single 300–400ms opacity/scale-from-0.97 entrance on a completion summary would fit.

## Plans

| # | Title | Severity | Status | Depends on |
| --- | --- | --- | --- | --- |
| 001 | [Overlay exits use ease-out](001-overlay-exits-ease-out.md) | HIGH | TODO | — |
| 002 | [Overlay entrance follows its side](002-overlay-entrance-follows-side.md) | MEDIUM | TODO | 001 |
| 003 | [Reduced motion keeps fades](003-reduced-motion-keeps-fades.md) | MEDIUM | TODO | — |
| 004 | [Measure the dock expand layout cost](004-dock-expand-layout-cost.md) | MEDIUM | TODO | — |
| 005 | [Turn ring animates composite-only properties](005-turn-ring-composite-only.md) | LOW | TODO | — |
| 006 | [Sheet uses the drawer curve](006-sheet-drawer-curve.md) | LOW | TODO | 001 |
| 007 | [Consolidate motion tokens](007-motion-token-consolidation.md) | LOW | TODO | 001, 006 |

Recommended order: 001 → 003 → 002 → 004 → 006 → 005 → 007. Plans 002 and 006 edit the same `index.css` block as 001. Plan 007 should run last because it touches the files every other plan edits.
