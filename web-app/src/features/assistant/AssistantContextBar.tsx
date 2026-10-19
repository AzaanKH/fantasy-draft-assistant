import { type DraftType, createSlotSequence, type DecisionLens } from '@fantasy-draft/shared';
import * as React from 'react';

import type { AssistantDraftMode, PickWindow, SyncTone } from './assistant-context';

const MODE_LABELS: Readonly<Record<AssistantDraftMode, string>> = {
  companion: 'Companion',
  'manual-continuity': 'Manual Continuity',
  mock: 'Quick Mock',
  preview: 'Preview',
};

/** Pick context, sync freshness and the Best Pick / Best Player lens. */
export function AssistantContextBar({
  isMyTurn,
  pickWindow,
  totalTeams,
  draftType,
  mode,
  sync,
  lens,
  onLensChange,
}: {
  readonly isMyTurn: boolean;
  readonly pickWindow: PickWindow;
  readonly totalTeams: number;
  readonly draftType: DraftType;
  readonly mode: AssistantDraftMode;
  readonly sync: { readonly tone: SyncTone; readonly label: string };
  readonly lens: DecisionLens;
  readonly onLensChange: (lens: DecisionLens) => void;
}): React.ReactElement {
  const currentLabel = createSlotSequence({ type: draftType, teams: totalTeams, rounds: Math.ceil(pickWindow.currentPick / totalTeams) }).label(pickWindow.currentPick);
  const nextLabel = pickWindow.nextPick === null ? null : createSlotSequence({ type: draftType, teams: totalTeams, rounds: Math.ceil(pickWindow.nextPick / totalTeams) }).label(pickWindow.nextPick);
  const between = `${String(pickWindow.picksBetween.length)} ${pickWindow.picksBetween.length === 1 ? 'pick' : 'picks'}`;

  return (
    <div className="rec-context">
      <div className="rec-context-pick">
        <span className="rec-clock" data-state={isMyTurn ? 'clock' : 'waiting'}>
          {isMyTurn ? 'Your turn' : 'On the clock'}
        </span>
        <strong>Pick {currentLabel}</strong>
        {nextLabel ? (
          <span className="rec-muted">
            {pickWindow.onClock ? `Next pick ${nextLabel} · ${between} in between` : `Your pick ${nextLabel} · ${between} before it`}
          </span>
        ) : <span className="rec-muted">{pickWindow.onClock ? 'Your final pick' : 'No picks left'}</span>}
      </div>
      <div className="rec-context-status">
        <span className="rec-sync" data-sync={sync.tone} role="status">
          <span className="rec-sync-dot" aria-hidden="true" />
          {sync.label}
        </span>
        <span className="rec-muted rec-mode-label">{MODE_LABELS[mode]}</span>
        <div className="rec-lens" role="group" aria-label="Decision lens">
          <button type="button" aria-pressed={lens === 'best-pick'} onClick={() => { onLensChange('best-pick'); }}>Best Pick</button>
          <button type="button" aria-pressed={lens === 'best-player'} onClick={() => { onLensChange('best-player'); }}>Best Player</button>
        </div>
      </div>
    </div>
  );
}
