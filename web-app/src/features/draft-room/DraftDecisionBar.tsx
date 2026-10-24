import { useDraftView } from '@/workspace/useDraftView';
import * as React from 'react';
import { ArrowRight, Check, ListPlus } from 'lucide-react';
import { MotionFade } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { MetricHelp } from '@/features/help/MetricHelp';
import type { AssistantNavigationTarget } from '@/features/assistant/assistant-navigation';
import { useDraftDecision } from '@/features/recommendations/DraftDecisionContext';
import { useQueueActions } from '@/hooks/useQueueActions';
import { getDraftDecisionBarReason } from './draft-decision-bar-reason';

export function DraftDecisionBar({
  onOpenAssistant,
}: {
  readonly onOpenAssistant: (target: AssistantNavigationTarget) => void;
}): React.ReactElement {
  const { output, isLoading, recommendationsBlocked } = useDraftDecision();
  const bestPick = output.bestPick;
  const isQueued = useDraftView((view) =>
    bestPick ? view.shortlistedPlayerIds.includes(bestPick.playerId) : false
  );
  const queuePlayerIdentity = React.useMemo(
    () => bestPick ? [{ id: bestPick.playerId, name: bestPick.playerName }] : [],
    [bestPick]
  );
  const { togglePlayerQueued } = useQueueActions(queuePlayerIdentity);

  if (!bestPick) {
    return (
      <section className="draft-best-pick-inline" aria-label="Current Best Pick" aria-live="polite" aria-busy={isLoading}>
        <div className="draft-best-pick-content">
          <span className="text-xs font-semibold text-primary">Best Pick</span>
          <p className="text-sm text-muted-foreground">
            {isLoading
              ? 'Finding your best pick…'
              : recommendationsBlocked
                ? 'Paused until setup is finished. See the checklist above.'
                : 'No pick available'}
          </p>
        </div>
      </section>
    );
  }

  const reason = getDraftDecisionBarReason(
    bestPick,
    output.decisionDivergenceFactor
  );

  return (
    <section className="draft-best-pick-inline" aria-label="Current Best Pick" aria-live="polite">
      <div className="draft-best-pick-content">
        <span className="draft-best-pick-label">
          <MetricHelp metric="bestPick" context={<p><strong>{bestPick.playerName}.</strong> {reason}</p>} />
        </span>
        <MotionFade motionKey={`${bestPick.playerId}:${reason}`} className="draft-best-pick-recommendation">
          <div className="draft-best-pick-identity">
            <strong title={bestPick.playerName}>{bestPick.playerName}</strong>
            <span>{bestPick.position}</span>
          </div>
          <p title={reason}>{reason}</p>
        </MotionFade>
      </div>
      <div className="draft-best-pick-actions">
        <Button variant={isQueued ? 'secondary' : 'outline'} size="sm" className="draft-best-pick-queue" aria-pressed={isQueued}
          aria-label={isQueued ? `Remove ${bestPick.playerName} from the local queue` : `Add ${bestPick.playerName} to the local queue`}
          onClick={() => { togglePlayerQueued(bestPick.playerId); }}>
          {isQueued ? <Check className="size-4" /> : <ListPlus className="size-4" />}
          {isQueued ? 'Queued' : 'Queue'}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => { onOpenAssistant({ lens: 'why', selectedPlayerId: bestPick.playerId }); }}>
          Why this pick <ArrowRight className="size-3.5" />
        </Button>
      </div>
    </section>
  );
}
