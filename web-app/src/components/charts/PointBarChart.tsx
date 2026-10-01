import { useId } from 'react';
import { chartTooltipStyles } from './tooltip-styles';
import { Bar, BarChart, CartesianGrid, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { usePrefersReducedMotion } from '@/components/motion';
import { comparisonScale } from '@/features/assistant/comparison-metrics';

interface PointRow {
  readonly id: string;
  readonly name: string;
  readonly value: number | null;
  readonly preferred?: boolean;
}

/** A zero-based point comparison. Missing estimates remain missing, never zero. */
export function PointBarChart({ title, description, rows }: {
  readonly title: string;
  readonly description: string;
  readonly rows: readonly PointRow[];
}): React.ReactElement {
  const titleId = useId();
  const reduceMotion = usePrefersReducedMotion();
  const scale = comparisonScale(rows.map((row) => row.value));
  const hasValues = rows.some((row) => row.value !== null);
  const format = (value: unknown): string => typeof value === 'number' && Number.isFinite(value) ? `${String(Number(value.toFixed(1)))} pts` : 'Unavailable';
  return <figure aria-labelledby={titleId} className="min-w-0 rounded-md border border-border p-3">
    <figcaption id={titleId} className="text-sm font-semibold">{title}</figcaption>
    <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
    {hasValues ? <div className="mt-2 h-44 min-w-0" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart data={rows.map((row) => ({ ...row, fill: row.preferred ? 'var(--color-primary)' : 'var(--color-muted-foreground)' }))} layout="vertical" accessibilityLayer={false} margin={{ top: 6, right: 52, bottom: 2, left: 8 }}>
          <CartesianGrid horizontal={false} stroke="var(--color-border)" strokeDasharray="3 3" />
          <XAxis type="number" domain={[scale.min < 0 ? scale.min * 1.2 : 0, scale.max > 0 ? scale.max * 1.1 : 0]} tick={{ fill: 'var(--color-muted-foreground)', fontSize: 11 }} tickLine={false} axisLine={false} tickCount={3} tickFormatter={(value: number) => String(Math.round(value))} />
          <YAxis type="category" dataKey="name" width={112} tick={{ fill: 'var(--color-foreground)', fontSize: 11 }} tickLine={false} axisLine={false} />
          <Tooltip formatter={(value) => format(value)} cursor={{ fill: 'var(--color-muted)', opacity: 0.5 }} {...chartTooltipStyles} />
          <ReferenceLine x={0} stroke="var(--color-muted-foreground)" />
          <Bar dataKey="value" name={title} maxBarSize={20} isAnimationActive={!reduceMotion} animationDuration={220}>
            <LabelList dataKey="value" position="right" formatter={(value: unknown) => typeof value === 'number' ? String(Number(value.toFixed(1))) : ''} fill="var(--color-foreground)" fontSize={11} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div> : <p className="py-6 text-sm text-muted-foreground">Point estimates are unavailable.</p>}
    <ul className="sr-only">{rows.map((row) => <li key={row.id}>{row.name}: {format(row.value)}{row.preferred ? ', preferred for this pick' : ''}</li>)}</ul>
    {rows.filter((row) => row.value === null).map((row) => <p key={row.id} className="text-xs text-muted-foreground">{row.name}: Unavailable</p>)}
  </figure>;
}
