import * as React from 'react';
import {
  BadgeCheck,
  CircleAlert,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { DraftReconciliationSummary } from '@/hooks/useDraftSync';
import { formatRoundPick } from '@/lib/mock-draft-engine';
import { cn } from '@/lib/utils';

function PickLocation({
  pickNumber,
  totalTeams,
}: {
  readonly pickNumber: number;
  readonly totalTeams: number;
}): React.ReactElement {
  return (
    <span className="font-mono tabular-nums">
      {formatRoundPick(pickNumber, totalTeams)} · #{String(pickNumber)}
    </span>
  );
}

export function ReconciliationSummary({
  summary,
  totalTeams,
  onDismiss,
}: {
  readonly summary: DraftReconciliationSummary;
  readonly totalTeams: number;
  readonly onDismiss: () => void;
}): React.ReactElement {
  const hasUnresolved = summary.unresolvedIdentities.length > 0;
  const hasCorrections = summary.corrections.length > 0;
  const hasRemovals = summary.removals.length > 0;
  const hasChangedProviderTruth = hasCorrections || hasRemovals;
  const Icon = hasUnresolved
    ? CircleAlert
    : hasChangedProviderTruth
      ? RefreshCw
      : BadgeCheck;

  return (
    <section
      className={cn(
        'rounded-xl border px-4 py-3 shadow-sm',
        hasUnresolved
          ? 'border-red-500/45 bg-red-500/[0.08]'
          : hasChangedProviderTruth
            ? 'border-amber-500/45 bg-amber-500/[0.08]'
            : 'border-emerald-500/45 bg-emerald-500/[0.08]'
      )}
      role={hasUnresolved ? 'alert' : 'status'}
      aria-live={hasUnresolved ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      <div className="flex items-start gap-3">
        <Icon
          className={cn(
            'mt-0.5 size-5 shrink-0',
            hasUnresolved
              ? 'text-red-700 dark:text-red-300'
              : hasChangedProviderTruth
                ? 'text-amber-700 dark:text-amber-300'
                : 'text-emerald-700 dark:text-emerald-300'
          )}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold">
            {hasUnresolved
              ? 'Provider Truth needs identity repair'
              : 'Provider Truth reconciled'}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {hasUnresolved
              ? 'Resolved picks now follow the complete provider snapshot. Live recommendations remain off because an unresolved player can change rosters and availability.'
              : 'Rosters, availability, current pick, and both Decision Lenses now use the complete provider snapshot.'}
          </p>

          {summary.confirmations.length > 0 ? (
            <div className="mt-3">
              <h3 className="flex items-center gap-1.5 text-xs font-bold text-emerald-800 dark:text-emerald-300">
                <BadgeCheck className="size-3.5" aria-hidden="true" />
                Confirmed · {String(summary.confirmations.length)}
              </h3>
              <ul className="mt-1 space-y-1" aria-label="Confirmed Provisional Picks">
                {summary.confirmations.map((confirmation) => (
                  <li
                    key={`${String(confirmation.pickNumber)}:${confirmation.playerId}`}
                    className="text-xs text-foreground"
                  >
                    <span className="font-semibold">{confirmation.playerName}</span>
                    <span className="text-muted-foreground">
                      {' '}· {confirmation.position} · Pick{' '}
                      <PickLocation
                        pickNumber={confirmation.pickNumber}
                        totalTeams={totalTeams}
                      />
                      {' '}· {confirmation.teamName}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {summary.corrections.length > 0 ? (
            <div className="mt-3">
              <h3 className="flex items-center gap-1.5 text-xs font-bold text-amber-800 dark:text-amber-300">
                <RefreshCw className="size-3.5" aria-hidden="true" />
                Corrected · {String(summary.corrections.length)}
              </h3>
              <ul className="mt-1 space-y-1" aria-label="Corrected draft picks">
                {summary.corrections.map((correction) => (
                  <li
                    key={`${String(correction.pickNumber)}:${correction.provider.playerId}`}
                    className="text-xs text-foreground"
                  >
                    Pick{' '}
                    <PickLocation
                      pickNumber={correction.pickNumber}
                      totalTeams={totalTeams}
                    />
                    <span className="text-muted-foreground"> · </span>
                    <span className="font-semibold">
                      {correction.previous.playerName}
                    </span>
                    <span className="text-muted-foreground"> was replaced by </span>
                    <span className="font-semibold">
                      {correction.provider.playerName}
                    </span>
                    <span className="text-muted-foreground">
                      {' '}· {correction.provider.position} · {correction.provider.teamName}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {summary.removals.length > 0 ? (
            <div className="mt-3">
              <h3 className="flex items-center gap-1.5 text-xs font-bold text-amber-800 dark:text-amber-300">
                <Trash2 className="size-3.5" aria-hidden="true" />
                Removed · {String(summary.removals.length)}
              </h3>
              <ul className="mt-1 space-y-1" aria-label="Removed draft picks">
                {summary.removals.map((removal) => {
                  const sourceLabel = removal.source === 'provisional'
                    ? 'Provisional Pick'
                    : removal.source === 'sync'
                      ? 'prior Provider Pick'
                      : 'local pick';
                  return (
                    <li
                      key={`${String(removal.pickNumber)}:${removal.playerId}`}
                      className="text-xs text-foreground"
                    >
                      <span className="font-semibold">{removal.playerName}</span>
                      <span className="text-muted-foreground">
                        {' '}· Pick{' '}
                        <PickLocation
                          pickNumber={removal.pickNumber}
                          totalTeams={totalTeams}
                        />
                        {' '}· {sourceLabel} absent from Provider Truth
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {summary.unresolvedIdentities.length > 0 ? (
            <div className="mt-3">
              <h3 className="flex items-center gap-1.5 text-xs font-bold text-red-800 dark:text-red-300">
                <CircleAlert className="size-3.5" aria-hidden="true" />
                Unresolved identities · {String(summary.unresolvedIdentities.length)}
              </h3>
              <ul className="mt-1 space-y-1" aria-label="Unresolved provider identities">
                {summary.unresolvedIdentities.map((pick) => (
                  <li
                    key={`${String(pick.pickNumber)}:${pick.playerId}`}
                    className="text-xs text-foreground"
                  >
                    <span className="font-semibold">{pick.playerName}</span>
                    <span className="text-muted-foreground">
                      {' '}· Pick{' '}
                      <PickLocation
                        pickNumber={pick.pickNumber}
                        totalTeams={totalTeams}
                      />
                      {pick.nflTeam ? ` · ${pick.nflTeam}` : ''} · Provider ID{' '}
                      <span className="font-mono">{pick.playerId}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs font-medium text-red-800 dark:text-red-300">
                Action: refresh player identity data, reload the app, then retry
                provider sync. Add an explicit provider ID mapping if the player
                still does not match.
              </p>
            </div>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onDismiss}
          aria-label="Dismiss reconciliation summary"
        >
          <X />
        </Button>
      </div>
    </section>
  );
}
