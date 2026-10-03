import { MotionReorderItem } from '@/components/motion';
import { PositionTag } from '@/components/PositionTag';
import { formatSignedNumber } from '@/lib/utils';
import { type Player, type Recommendation } from '@fantasy-draft/shared';
import { Check, Plus } from 'lucide-react';
import * as React from 'react';

import { survivalPercent } from './assistant-analysis';

/** Column headings for candidate rows; values align right under them. */
export function CandidateRowHeader(): React.ReactElement {
  return (
    <div className="rec-candidate-head" aria-hidden="true">
      <span>#</span><span>Player</span><span>VOR</span><span>At next pick</span><span />
    </div>
  );
}

export function AssistantRecommendationRow({
  recommendation,
  player,
  rank,
  order,
  isSelected,
  isBestPick,
  isQueued,
  alert,
  onSelect,
  onQueue,
}: {
  readonly recommendation: Recommendation;
  readonly player?: Player;
  readonly rank: number;
  readonly order: number;
  readonly isSelected: boolean;
  readonly isBestPick: boolean;
  readonly isQueued: boolean;
  readonly alert?: string;
  readonly onSelect: (playerId: string) => void;
  readonly onQueue: (playerId: string) => void;
}): React.ReactElement {
  const diagnostics = recommendation.diagnostics;
  const survival = survivalPercent(recommendation);

  return (
    <div data-player-row>
      <MotionReorderItem order={order} className={isSelected ? 'rec-candidate rec-candidate-selected' : 'rec-candidate'}>
        <span className="rec-candidate-rank" aria-label={`Rank ${String(rank)}`}>{String(rank)}</span>
        <button
          type="button"
          onClick={() => { onSelect(recommendation.playerId); }}
          aria-pressed={isSelected}
          className="rec-candidate-identity"
        >
          <span className="rec-candidate-name">{recommendation.playerName}</span>
          <span className="rec-meta">
            <PositionTag position={recommendation.position} />
            <span>{player?.team ?? 'FA'}</span>
            {diagnostics ? <span>Tier {String(diagnostics.tier)}</span> : null}
            {isBestPick ? <span className="rec-accent">Best Pick</span> : null}
            {isSelected ? <span className="rec-viewing">Viewing</span> : null}
          </span>
          {alert ? <span className="rec-alert">{alert}</span> : null}
        </button>
        <span className="rec-candidate-value">{diagnostics ? formatSignedNumber(diagnostics.valueOverReplacement, 0) : '—'}</span>
        <span className="rec-candidate-value">{survival === null ? <span className="rec-unknown">—</span> : `${String(survival)}%`}</span>
        <button
          type="button"
          className="rec-icon-button rec-queue-toggle"
          aria-pressed={isQueued}
          aria-label={`${isQueued ? 'Remove' : 'Add'} ${recommendation.playerName} ${isQueued ? 'from' : 'to'} queue`}
          onClick={() => { onQueue(recommendation.playerId); }}
        >
          {isQueued ? <Check aria-hidden="true" /> : <Plus aria-hidden="true" />}
        </button>
      </MotionReorderItem>
    </div>
  );
}
