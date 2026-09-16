import * as React from 'react';
import type { DecisionLens, Recommendation } from '@fantasy-draft/shared';
import { Check, GitCompareArrows, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { DraftDecisionOutput } from '@/features/recommendations/draft-decision';
import { cn } from '@/lib/utils';

function getEcrLabel(recommendation: Recommendation | null): string {
  const rank = recommendation?.diagnostics?.expertRank;
  return rank === undefined ? 'ECR unavailable' : `Trusted ECR #${String(rank)}`;
}

function LensButton({
  lens,
  label,
  description,
  recommendation,
  preferred,
  selectedLens,
  onChange,
}: {
  readonly lens: DecisionLens;
  readonly label: string;
  readonly description: string;
  readonly recommendation: Recommendation | null;
  readonly preferred?: boolean;
  readonly selectedLens: DecisionLens;
  readonly onChange: (lens: DecisionLens) => void;
}): React.ReactElement {
  const isSelected = selectedLens === lens;

  return (
    <button
      type="button"
      aria-pressed={isSelected}
      onClick={() => { onChange(lens); }}
      className={cn(
        'min-w-0 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isSelected
          ? 'border-emerald-500/55 bg-emerald-500/[0.09]'
          : 'border-border/70 bg-background/35 hover:bg-muted/45'
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold">{label}</span>
        {preferred || isSelected ? (
          <Badge className="h-5 shrink-0 bg-emerald-600 px-1.5 text-[9px] text-white hover:bg-emerald-600 dark:bg-emerald-500 dark:text-emerald-950">
            <Check className="size-3" />
            {preferred ? 'Preferred' : 'Viewing'}
          </Badge>
        ) : null}
      </span>
      <span className="mt-1 block truncate text-sm font-semibold">
        {recommendation?.playerName ?? 'No available player'}
      </span>
      <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
        {lens === 'best-player' ? getEcrLabel(recommendation) : description}
      </span>
    </button>
  );
}

export function DecisionLensSwitcher({
  output,
  onChange,
}: {
  readonly output: DraftDecisionOutput;
  readonly onChange: (lens: DecisionLens) => void;
}): React.ReactElement {
  const agreementPlayer = output.bestPick ?? output.bestPlayer;

  return (
    <section className="border-b border-border/70 bg-muted/15 px-4 py-3" aria-labelledby="decision-lens-heading">
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-300" />
        <div className="min-w-0">
          <h3 id="decision-lens-heading" className="text-xs font-bold">Decision Lens</h3>
          <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
            Best Pick optimizes the completed Primary League roster. Use this same decision surface for preparation, mock rehearsal, and the live Primary League draft.
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="Choose Decision Lens">
        <LensButton
          lens="best-pick"
          label="Best Pick"
          description="Completed-roster policy · preferred"
          recommendation={output.bestPick}
          preferred
          selectedLens={output.selectedLens}
          onChange={onChange}
        />
        <LensButton
          lens="best-player"
          label="Best Player"
          description="Trusted ECR Anchor"
          recommendation={output.bestPlayer}
          selectedLens={output.selectedLens}
          onChange={onChange}
        />
      </div>

      <div className="mt-2 flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground" aria-live="polite">
        {output.decisionDivergence ? (
          <>
            <GitCompareArrows className="mt-0.5 size-3 shrink-0 text-amber-700 dark:text-amber-300" />
            <span>
              <strong className="text-foreground">Decision Divergence.</strong>{' '}
              {output.decisionDivergenceExplanation ??
                `Best Pick is ${output.bestPick?.playerName}; Best Player is ${output.bestPlayer?.playerName}.`}
            </span>
          </>
        ) : (
          <>
            <Check className="mt-0.5 size-3 shrink-0 text-emerald-700 dark:text-emerald-300" />
            <span>
              {agreementPlayer
                ? `Both lenses agree on ${agreementPlayer.playerName}.`
                : 'Both lenses are waiting for an available player.'}
            </span>
          </>
        )}
      </div>

      <p className="mt-2 border-t border-border/60 pt-2 text-[10px] leading-relaxed text-muted-foreground">
        Advice only: this workspace never submits, queues, or confirms a provider pick. Complete Sleeper actions in Sleeper.
      </p>
    </section>
  );
}
