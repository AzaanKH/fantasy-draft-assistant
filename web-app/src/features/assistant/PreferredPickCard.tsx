import { RANKING_LABELS, IS_DEMO } from '@/lib/demo-mode';
import { PlayerHeadshot } from '@/components/PlayerHeadshot';
import { PositionTag } from '@/components/PositionTag';
import { Button } from '@/components/ui/button';
import { MetricHelp } from '@/features/help/MetricHelp';
import { getProviderName } from '@/lib/provider-name';
import { formatSignedNumber } from '@/lib/utils';
import type { DraftProvider, Player, Position, Recommendation } from '@fantasy-draft/shared';
import { Check, ListPlus } from 'lucide-react';
import * as React from 'react';

import type { AssistantDraftMode } from './assistant-context';
import { getWaitingCostSummary, survivalPercent } from './assistant-analysis';

export interface LensDivergence {
  readonly label: 'Best Pick' | 'Best Player';
  readonly playerId: string;
  readonly playerName: string;
  readonly position: Position;
  readonly reason: string | null;
}

export interface PickAction {
  readonly mode: AssistantDraftMode;
  readonly provider: DraftProvider | null;
  readonly canDraft: boolean;
  readonly disabledReason: string | null;
  readonly onDraft: () => void;
  readonly onRecordPick: () => void;
}

function ActionNote({ mode, provider, disabledReason }: {
  readonly mode: AssistantDraftMode;
  readonly provider: DraftProvider | null;
  readonly disabledReason: string | null;
}): React.ReactElement {
  if (disabledReason) return <p className="rec-action-note">{disabledReason}</p>;
  if (mode === 'companion') {
    const where = provider ? getProviderName(provider) : 'your draft room';
    return <p className="rec-action-note">Make the pick in {where}. This assistant does not submit picks.</p>;
  }
  if (mode === 'manual-continuity') {
    return <p className="rec-action-note"><span className="rec-alert">Provisional</span> Record each pick in the Draft Workspace as it happens. It is confirmed when sync returns.</p>;
  }
  if (mode === 'preview') return <p className="rec-action-note">{IS_DEMO ? 'Preview. Start a mock to make picks.' : 'Preview. Connect a draft or start a mock to make picks.'}</p>;
  return <p className="rec-action-note">Quick Mock. Picks are made here.</p>;
}

/** The lens leader: identity, waiting cost first, then value, timing and tier, with the mode's main action. */
export function PreferredPickCard({
  recommendation,
  player,
  lensLabel,
  alerts,
  divergence,
  isQueued,
  queuePosition,
  action,
  onQueue,
  onViewPlayer,
  onCompare,
}: {
  readonly recommendation: Recommendation;
  readonly player?: Player;
  readonly lensLabel: 'Best Pick' | 'Best Player';
  readonly alerts: readonly string[];
  readonly divergence: LensDivergence | null;
  readonly isQueued: boolean;
  readonly queuePosition: number;
  readonly action: PickAction;
  readonly onQueue: () => void;
  readonly onViewPlayer: (playerId: string) => void;
  readonly onCompare: () => void;
}): React.ReactElement {
  const diagnostics = recommendation.diagnostics;
  const survival = survivalPercent(recommendation);
  const waiting = getWaitingCostSummary(recommendation);
  const tierSupply = recommendation.decisionFactors?.tierSupply;
  const nextPick = waiting.nextPickLabel ?? 'your next pick';
  const lastName = recommendation.playerName.split(' ').slice(-1)[0] ?? recommendation.playerName;
  const queueButton = (primary: boolean): React.ReactElement => (
    <Button variant={primary ? 'default' : 'secondary'} className="rec-action" aria-pressed={isQueued} onClick={onQueue}>
      {isQueued ? <Check aria-hidden="true" /> : <ListPlus aria-hidden="true" />}
      {isQueued ? `In queue · #${String(queuePosition)}` : 'Add to queue'}
    </Button>
  );

  return (
    <article className="rec-card" aria-labelledby="rec-card-name">
      <div className="rec-card-identity">
        <PlayerHeadshot
          playerId={recommendation.playerId}
          name={recommendation.playerName}
          position={recommendation.position}
          className="rec-card-avatar"
        />
        <div className="min-w-0">
          <h2 id="rec-card-name" className="rec-card-name">{recommendation.playerName}</h2>
          <div className="rec-meta">
            <PositionTag position={recommendation.position} />
            {player?.team ? <span>{player.team}</span> : null}
            {diagnostics ? <span>{RANKING_LABELS.short} {String(diagnostics.expertRank)}</span> : null}
            {player?.consensusAdp ? <span>ADP {player.consensusAdp.toFixed(1)}</span> : null}
            {player?.byeWeek ? <span>Bye {String(player.byeWeek)}</span> : null}
          </div>
        </div>
        <span className="rec-card-label">{lensLabel}</span>
      </div>
      {alerts.length > 0 ? (
        <div className="rec-alerts">{alerts.map((alert) => <span key={alert} className="rec-alert">{alert}</span>)}</div>
      ) : null}
      <dl className="rec-metrics">
        <div className="rec-metric rec-metric-lead">
          <dt><MetricHelp metric="waitingCost" label={`Waiting cost to ${nextPick}`} /></dt>
          <dd className="rec-metric-value">{waiting.costOfWaiting === null ? <span className="rec-unknown">Unavailable</span> : `${waiting.costOfWaiting.toFixed(1)} pts`}</dd>
          <dd className="rec-metric-note">
            {waiting.costOfWaiting === null
              ? 'Timing inputs are missing.'
              : waiting.fallbackName
                ? `Fallback: ${waiting.fallbackName}, ${formatSignedNumber(waiting.fallbackValue ?? 0, 0)} expected`
                : 'No same-position fallback'}
          </dd>
        </div>
        <div className="rec-metric">
          <dt><MetricHelp metric="vor" label="Above replacement (VOR)" /></dt>
          <dd className="rec-metric-value">{diagnostics ? formatSignedNumber(diagnostics.valueOverReplacement, 0) : <span className="rec-unknown">Unavailable</span>}</dd>
        </div>
        <div className="rec-metric">
          <dt><MetricHelp metric="returnProbability" label="At next pick" /></dt>
          <dd className="rec-metric-value">{survival === null ? <span className="rec-unknown">Unavailable</span> : `${String(survival)}%`}</dd>
        </div>
        <div className="rec-metric">
          <dt>
            <MetricHelp metric="tier" label={tierSupply ? `${String(tierSupply.remainingInTier)} left in tier` : 'Position tier'} />
          </dt>
          <dd className="rec-metric-value">{diagnostics ? `Tier ${String(diagnostics.tier)}` : '—'}</dd>
        </div>
      </dl>
      {divergence ? (
        <div className="rec-divergence">
          <span className="rec-muted">{divergence.label} differs</span>
          <span className="rec-divergence-player"><PositionTag position={divergence.position} /><strong>{divergence.playerName}</strong></span>
          {divergence.reason ? <span className="rec-divergence-reason">{divergence.reason}</span> : null}
          <button type="button" className="rec-text-button" onClick={() => { onViewPlayer(divergence.playerId); }}>View</button>
        </div>
      ) : null}
      <div className="rec-actions">
        {action.mode === 'mock' ? (
          <>
            <Button className="rec-action" disabled={!action.canDraft} onClick={action.onDraft}>Draft {lastName}</Button>
            {queueButton(false)}
          </>
        ) : action.mode === 'manual-continuity' ? (
          <>
            <Button className="rec-action" onClick={action.onRecordPick}>Record pick</Button>
            {queueButton(false)}
          </>
        ) : queueButton(true)}
        <Button variant="outline" className="rec-action" onClick={onCompare}>Compare options</Button>
      </div>
      <ActionNote mode={action.mode} provider={action.provider} disabledReason={action.disabledReason} />
    </article>
  );
}
