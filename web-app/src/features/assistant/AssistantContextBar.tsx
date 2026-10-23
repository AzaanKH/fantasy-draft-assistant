import { createSlotSequence, type DecisionLens } from '@fantasy-draft/shared/draft';
import { type DraftType } from '@fantasy-draft/shared/sync';
import * as React from 'react';
import { getSyncStatus, type AssistantDraftMode, type PickWindow } from './assistant-context';
import { useNow } from '@/workspace/useNow';

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
  readonly sync: AssistantSyncStatusInput;
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
        <AssistantSyncStatus sync={sync} />
        <span className="rec-muted rec-mode-label">{MODE_LABELS[mode]}</span>
        <div className="rec-lens" role="group" aria-label="Decision lens">
          <button type="button" aria-pressed={lens === 'best-pick'} onClick={() => { onLensChange('best-pick'); }}>Best Pick</button>
          <button type="button" aria-pressed={lens === 'best-player'} onClick={() => { onLensChange('best-player'); }}>Best Player</button>
        </div>
      </div>
    </div>
  );
}

type AssistantSyncStatusInput = Omit<Parameters<typeof getSyncStatus>[0], 'lastSyncAgeMs'> & {
  readonly lastSuccessfulSyncAt: number | null;
};

function AssistantSyncStatus({ sync }: { readonly sync: AssistantSyncStatusInput }): React.ReactElement {
  const now = useNow();
  const { lastSuccessfulSyncAt, ...input } = sync;
  const status = getSyncStatus({
    ...input,
    lastSyncAgeMs: lastSuccessfulSyncAt === null ? null : Math.max(0, now - lastSuccessfulSyncAt),
  });
  return (
    <span className="rec-sync" data-sync={status.tone} role="status">
      <span className="rec-sync-dot" aria-hidden="true" />
      {status.label}
    </span>
  );
}
