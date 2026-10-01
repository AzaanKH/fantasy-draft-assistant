import type { Recommendation } from '@fantasy-draft/shared';
import type { HelpMetric } from '@/features/help/metric-help-content';
import { survivalPercent } from './assistant-analysis';

export interface ComparisonMetric {
  readonly key: HelpMetric;
  readonly label: string;
  readonly description: string;
  readonly values: readonly [number | null, number | null];
  readonly format: 'points' | 'signed-points' | 'percent' | 'rank' | 'tier';
  readonly scale?: { readonly min: number; readonly max: number };
}

function finite(value: number | undefined | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function comparisonScale(values: readonly (number | null)[]): { min: number; max: number } {
  const available = values.filter((value): value is number => value !== null && Number.isFinite(value));
  const min = Math.min(0, ...available);
  const max = Math.max(0, ...available);
  return { min, max: max === min ? min + 1 : max };
}

export function comparisonBar(value: number | null, scale: { readonly min: number; readonly max: number }): {
  readonly left: number;
  readonly width: number;
  readonly zero: number;
} | null {
  if (value === null || !Number.isFinite(value) || scale.max <= scale.min) return null;
  const range = scale.max - scale.min;
  const clamped = Math.max(scale.min, Math.min(scale.max, value));
  const zero = (0 - scale.min) / range * 100;
  const endpoint = (clamped - scale.min) / range * 100;
  return { left: Math.min(zero, endpoint), width: Math.abs(endpoint - zero), zero };
}

export function getComparisonMetrics(
  first: Recommendation,
  second: Recommendation,
  ranks: ReadonlyMap<string, number>
): readonly ComparisonMetric[] {
  const value: readonly [number | null, number | null] = [
    finite(first.diagnostics?.valueOverReplacement), finite(second.diagnostics?.valueOverReplacement),
  ];
  const projected: readonly [number | null, number | null] = [
    finite(first.diagnostics?.projectedPoints), finite(second.diagnostics?.projectedPoints),
  ];
  const probability = (recommendation: Recommendation): number | null => {
    const percent = finite(survivalPercent(recommendation));
    return percent !== null && percent >= 0 && percent <= 100 ? percent : null;
  };

  return [
    { key: 'vor', label: 'Above replacement', description: 'Positional advantage, in points.', values: value, format: 'signed-points', scale: comparisonScale(value) },
    { key: 'projectedPoints', label: 'Projected points', description: 'Season total in your scoring format.', values: projected, format: 'points', scale: comparisonScale(projected) },
    { key: 'returnProbability', label: 'At next pick', description: 'Availability estimate, not player quality.', values: [probability(first), probability(second)], format: 'percent', scale: { min: 0, max: 100 } },
    { key: 'tier', label: 'Position tier', description: first.position === second.position ? `Within ${first.position}; lower tiers are stronger.` : 'Tiers are relative to each position.', values: [finite(first.diagnostics?.tier), finite(second.diagnostics?.tier)], format: 'tier' },
    { key: 'ecr', label: 'ECR anchor', description: 'Expert rank; lower is better.', values: [finite(first.diagnostics?.expertRank), finite(second.diagnostics?.expertRank)], format: 'rank' },
    { key: 'recommendationRank', label: 'Recommendation rank', description: 'Order in the current decision lens.', values: [finite(ranks.get(first.playerId)), finite(ranks.get(second.playerId))], format: 'rank' },
  ];
}
