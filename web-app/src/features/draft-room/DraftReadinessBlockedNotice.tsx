import { CircleAlert, LoaderCircle, PlugZap, RefreshCw, Settings2 } from 'lucide-react';
import {
  formatDraftReadinessAge,
  REFRESHABLE_CORE_DRAFT_DATA_KEYS,
  type DraftReadinessItem,
  type DraftReadinessReport,
} from '@fantasy-draft/shared';
import { Button } from '@/components/ui/button';
import { useDraftDataRefresh } from '@/hooks/useDraftDataRefresh';
import { cn } from '@/lib/utils';
import { useDraftSetupActions } from './draft-setup-actions';

const REFRESHABLE_KEYS = new Set<string>(REFRESHABLE_CORE_DRAFT_DATA_KEYS);

function describeDataItem(item: DraftReadinessItem): string {
  if (item.problem === 'stale') return `${item.label} · ${formatDraftReadinessAge(item.ageHours)}`;
  if (item.problem === 'missing') return `${item.label} · missing`;
  if (item.problem === 'older-than-dependency') return `${item.label} · older than its inputs`;
  return `${item.label} · invalid`;
}

function DraftDataRefreshRow({ items }: { readonly items: readonly DraftReadinessItem[] }): React.ReactElement {
  const refresh = useDraftDataRefresh();
  const status = refresh.status;
  const isRunning = status?.state === 'running' || refresh.isStarting;
  const runningIndex = status?.steps.findIndex((step) => step.state === 'running') ?? -1;
  const runningStep = runningIndex >= 0 ? status?.steps[runningIndex] : undefined;

  return (
    <li className="draft-setup-item">
      <span className="draft-setup-marker" aria-hidden="true" />
      <div className="draft-setup-body">
        <h3>Draft data is out of date</h3>
        <p>{items.map(describeDataItem).join(' · ')}. Live recommendations need data refreshed within the last day.</p>
        {isRunning ? (
          <p className="draft-setup-progress" role="status">
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
            {runningStep
              ? `Refreshing ${runningStep.label} (${String(runningIndex + 1)} of ${String(status?.steps.length ?? 0)})…`
              : 'Starting refresh…'}
          </p>
        ) : status?.state === 'failed' ? (
          <div className="draft-setup-error" role="status">
            <p>{status.error}</p>
            {status.detail ? <pre>{status.detail}</pre> : null}
          </div>
        ) : null}
        {!refresh.isAvailable ? (
          <p className="draft-setup-hint">
            The local API server isn’t reachable. Restart the app with <code>pnpm dev:live</code>, which refreshes this data before starting.
          </p>
        ) : (
          <p className="draft-setup-hint">
            Runs the same refresh as <code>pnpm dev:live</code>. You can also run <code>pnpm draft:preflight</code> in a terminal.
          </p>
        )}
      </div>
      {refresh.isAvailable ? (
        <Button size="sm" className="draft-setup-action" disabled={isRunning} onClick={refresh.start}>
          {isRunning ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          {isRunning ? 'Refreshing' : status?.state === 'failed' ? 'Try again' : 'Refresh draft data'}
        </Button>
      ) : null}
    </li>
  );
}

function LeagueSettingsRow({
  item,
  showLeagueActions,
}: {
  readonly item: DraftReadinessItem;
  readonly showLeagueActions: boolean;
}): React.ReactElement {
  const { openLeagueSetup, openDraftConnection } = useDraftSetupActions();
  const canAct = showLeagueActions && (openLeagueSetup || openDraftConnection);

  return (
    <li className="draft-setup-item">
      <span className="draft-setup-marker" aria-hidden="true" />
      <div className="draft-setup-body">
        <h3>{item.label}</h3>
        {item.problem === 'missing' && canAct ? null : <p>{item.message}</p>}
        <p className="draft-setup-hint">
          {canAct
            ? 'For a Sleeper mock, choose Primary League practice settings or a quick mock. For your real draft, connect the Primary League.'
            : item.correctiveAction}
        </p>
      </div>
      {canAct ? (
        <div className="draft-setup-actions">
          {openLeagueSetup ? (
            <Button size="sm" className="draft-setup-action" onClick={openLeagueSetup}>
              <Settings2 className="size-4" /> League setup
            </Button>
          ) : null}
          {openDraftConnection ? (
            <Button size="sm" variant="outline" className="draft-setup-action" onClick={openDraftConnection}>
              <PlugZap className="size-4" /> Connect league
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function InstructionRow({ item }: { readonly item: DraftReadinessItem }): React.ReactElement {
  return (
    <li className="draft-setup-item">
      <span className="draft-setup-marker" aria-hidden="true" />
      <div className="draft-setup-body">
        <h3>{item.label}</h3>
        <p>{item.message}</p>
        <p className="draft-setup-hint">{item.correctiveAction}</p>
      </div>
    </li>
  );
}

/**
 * Lists every Core Draft Data blocker with the action that clears it. It stays visible until
 * readiness passes, so a reload or a new session shows what still needs attention.
 */
export function DraftReadinessBlockedNotice({
  readiness,
  className,
  showLeagueActions = true,
}: {
  readonly readiness: DraftReadinessReport;
  readonly className?: string;
  /** Hide league dialogs where the checklist already sits inside the connection flow. */
  readonly showLeagueActions?: boolean;
}): React.ReactElement {
  const failures = readiness.productBlockingFailures;
  const dataItems = failures.filter((item) => REFRESHABLE_KEYS.has(item.key));
  const otherItems = failures.filter((item) => !REFRESHABLE_KEYS.has(item.key));
  const issueCount = (dataItems.length > 0 ? 1 : 0) + otherItems.length;

  return (
    <section
      aria-labelledby="recommendations-blocked-heading"
      className={cn('draft-setup-checklist', className)}
      role="alert"
    >
      <div className="draft-setup-heading">
        <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
        <div>
          <h2 id="recommendations-blocked-heading">Finish setup to turn on recommendations</h2>
          <p>
            {issueCount === 1 ? '1 item needs' : `${String(issueCount)} items need`} attention. The board and picks keep updating; recommendations return as soon as every item passes.
          </p>
        </div>
      </div>
      <ul>
        {dataItems.length > 0 ? <DraftDataRefreshRow items={dataItems} /> : null}
        {otherItems.map((item) => item.key === 'primary-league-settings'
          ? <LeagueSettingsRow key={item.key} item={item} showLeagueActions={showLeagueActions} />
          : <InstructionRow key={item.key} item={item} />)}
      </ul>
    </section>
  );
}
