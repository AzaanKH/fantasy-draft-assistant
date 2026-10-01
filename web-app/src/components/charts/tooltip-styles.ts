import type { CSSProperties } from 'react';

// Recharts gives each item its own color; the container color alone cannot
// override it. Text uses theme foregrounds independently of the series fill.
export const chartTooltipStyles = {
  contentStyle: {
    background: 'var(--color-popover)',
    color: 'var(--color-popover-foreground)',
    borderColor: 'var(--color-border)',
    borderRadius: 6,
  } satisfies CSSProperties,
  labelStyle: { color: 'var(--color-popover-foreground)', fontWeight: 600 } satisfies CSSProperties,
  itemStyle: { color: 'var(--color-popover-foreground)' } satisfies CSSProperties,
};
