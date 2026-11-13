import * as React from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { NewsStatus, Player } from '@fantasy-draft/shared/league';
import { getInjuryTag } from '@/lib/player-status';
import { getPlayerRisk, type RiskLevel } from '@/lib/player-risk';
import { cn } from '@/lib/utils';

/** Semantic tones for compact status chips; colors come from design tokens (see .status-chip). */
export type StatusTone = 'neutral' | 'ok' | 'warn' | 'bad';

/**
 * Tinted text chip. Tone always pairs with text, never color alone. With `explanation` it is a focusable button that
 * shows the explanation in the shared tooltip on hover and keyboard focus, instead of a native title only a mouse
 * can reach; keep that to one chip per card so cards and rows do not gain a tab stop per chip.
 */
export function StatusChip({ tone, title, explanation, className, children }: {
  readonly tone: StatusTone;
  readonly title?: string;
  readonly explanation?: React.ReactNode;
  readonly className?: string;
  readonly children: React.ReactNode;
}): React.ReactElement {
  if (explanation === undefined) return <span className={cn('status-chip', className)} data-tone={tone} title={title}>{children}</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className={cn('status-chip status-chip-trigger', className)} data-tone={tone}>{children}</button>
      </TooltipTrigger>
      <TooltipContent side="top">{explanation}</TooltipContent>
    </Tooltip>
  );
}

/** Plain-language detail for an injury designation, or null when there is none to explain. */
export function getInjuryDetail(status: NewsStatus): string | null {
  return getInjuryTag(status)?.label ?? null;
}

/** Tinted text tag (Q / LIM / O). Renders nothing for healthy or unknown players unless `placeholder` is set. */
export function InjuryTag({ status, placeholder, className }: {
  readonly status: NewsStatus;
  readonly placeholder?: string;
  readonly className?: string;
}): React.ReactElement | null {
  const tag = getInjuryTag(status);
  if (!tag) return placeholder ? <span className={cn('text-muted-foreground', className)} aria-label="No injury designation">{placeholder}</span> : null;
  return (
    <abbr title={tag.label} aria-label={tag.label} className={cn('status-chip no-underline', className)} data-tone={tag.tone}>
      {tag.abbreviation}
    </abbr>
  );
}

const RISK_TONES: Readonly<Record<RiskLevel, StatusTone>> = { low: 'neutral', elevated: 'warn', high: 'bad' };

/**
 * Risk chip from the catalog's injury-risk and uncertainty scores. `minimum` hides lower levels,
 * so dense rows can show only elevated or high risk while cards always show it.
 */
export function RiskChip({ player, minimum = 'low', className }: {
  readonly player: Pick<Player, 'injuryRiskScore' | 'uncertaintyScore' | 'predictionSource'>;
  readonly minimum?: RiskLevel;
  readonly className?: string;
}): React.ReactElement | null {
  const risk = getPlayerRisk(player);
  const order: readonly RiskLevel[] = ['low', 'elevated', 'high'];
  if (!risk || order.indexOf(risk.level) < order.indexOf(minimum)) return null;
  return (
    <span className={cn('status-chip', className)} data-tone={RISK_TONES[risk.level]} title={risk.detail}>
      <span aria-hidden="true">{risk.label}</span>
      <span className="sr-only">{risk.detail}</span>
    </span>
  );
}
