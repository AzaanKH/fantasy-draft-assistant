# 002 — Overlay entrance follows its side

- **Status**: TODO
- **Commit**: e655db6
- **Severity**: MEDIUM
- **Category**: Physicality & origin
- **Estimated scope**: 1 file, ~15 lines

## Problem

Tooltips and popovers share one entrance that always rises from 3px below:

```css
/* web-app/src/index.css:18-20, 31-34 — current */
.metric-help-overlay {
  animation: metric-help-enter var(--motion-duration-feedback) var(--motion-ease-out);
}
@keyframes metric-help-enter {
  from { opacity: 0; transform: translateY(3px); }
  to { opacity: 1; transform: translateY(0); }
}
```

Radix Tooltip opens on `top` by default. Moving up takes the tooltip away from its trigger, which is correct. Radix Popover opens on `bottom` by default (`web-app/src/components/ui/popover.tsx:16-22`, `MetricHelp.tsx:52`, `DraftSessionStatus.tsx:44`, `ComparisonPlayerPicker.tsx:30`), so the popover travels up *toward* its trigger. When collisions flip a tooltip to the bottom, it has the same problem. Spatially, the panel should appear to come out of the trigger.

## Target

The offset starts on the trigger side for each Radix `data-side` value. Keep 3px, the existing duration, and the existing curve.

```css
/* target */
.metric-help-overlay {
  --metric-help-enter-from: translateY(3px);
  animation: metric-help-enter var(--motion-duration-feedback) var(--motion-ease-out);
}
.metric-help-overlay[data-side="bottom"] { --metric-help-enter-from: translateY(-3px); }
.metric-help-overlay[data-side="left"] { --metric-help-enter-from: translateX(3px); }
.metric-help-overlay[data-side="right"] { --metric-help-enter-from: translateX(-3px); }

@keyframes metric-help-enter {
  from { opacity: 0; transform: var(--metric-help-enter-from); }
  to { opacity: 1; transform: none; }
}
```

A custom property *read once in a keyframe* is fine here. It is not animated, and it sits on the overlay element itself, not on a parent with many children.

## Repo conventions to follow

- Overlay motion lives in `web-app/src/index.css` next to the existing `metric-help-*` rules.
- Radix sets `data-side` on both `TooltipPrimitive.Content` and `PopoverPrimitive.Content`. No component changes are needed.

## Steps

1. In `web-app/src/index.css`, add `--metric-help-enter-from: translateY(3px);` to the `.metric-help-overlay` rule.
2. Add the three `[data-side=…]` rules from Target directly below it.
3. Change `@keyframes metric-help-enter` to the Target version.
4. Leave `[data-state="closed"]` and `[data-state="instant-open"]` unchanged.

## Boundaries

- Do NOT change the duration or curve, and do NOT add scale.
- Do NOT edit `tooltip.tsx` or `popover.tsx`.
- If plan 001 hasn't run, leave the closed-state rule as you find it.
- If the code doesn't match (drift since `e655db6`), STOP and report.

## Verification

- **Mechanical**: `pnpm --filter web-app lint && pnpm --filter web-app test` pass.
- **Feel check**:
  - Hover a metric label (a tooltip above it) and confirm it drifts up, away from the label.
  - Click a metric label (a popover below it) and confirm it drifts down, away from the label.
  - Open the Draft session status popover and the comparison player picker, and confirm both drift down.
  - At 10% playback, confirm the movement is 3px and the panel never travels toward its trigger.
  - Under `prefers-reduced-motion: reduce`, the panel appears with no movement.
- **Done when**: every overlay side moves away from its trigger.
