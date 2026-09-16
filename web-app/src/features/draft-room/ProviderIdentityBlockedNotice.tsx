import * as React from 'react';
import { CircleAlert } from 'lucide-react';
import type { UnresolvedProviderPick } from '@/stores/draftStore';
import { formatRoundPick } from '@/lib/mock-draft-engine';
import { cn } from '@/lib/utils';

export function ProviderIdentityBlockedNotice({
  unresolvedPicks,
  totalTeams,
  className,
}: {
  readonly unresolvedPicks: readonly UnresolvedProviderPick[];
  readonly totalTeams: number;
  readonly className?: string;
}): React.ReactElement {
  const headingId = React.useId();
  const count = unresolvedPicks.length;

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'rounded-xl border border-red-500/45 bg-red-500/[0.08] p-4 shadow-sm',
        className
      )}
      role="alert"
    >
      <div className="flex items-start gap-2">
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-red-700 dark:text-red-300" />
        <div>
          <h2
            id={headingId}
            className="text-sm font-bold text-red-800 dark:text-red-300"
          >
            Live recommendations paused
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Provider Truth includes {String(count)} drafted{' '}
            {count === 1 ? 'player' : 'players'} that cannot map to canonical
            player data. The resolved picks remain visible, but Best Pick, Best
            Player, tier supply, and Return Probability stay off until every
            identity resolves.
          </p>
        </div>
      </div>

      <ul className="mt-3 space-y-2" aria-label="Unresolved provider identities">
        {unresolvedPicks.map((pick) => (
          <li
            key={`${String(pick.pickNumber)}:${pick.playerId}`}
            className="rounded-md border border-red-500/20 bg-background/75 px-3 py-2 text-xs"
          >
            <div className="font-semibold">{pick.playerName}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              Pick{' '}
              <span className="font-mono tabular-nums">
                {formatRoundPick(pick.pickNumber, totalTeams)} · #
                {String(pick.pickNumber)}
              </span>
              {pick.nflTeam ? ` · ${pick.nflTeam}` : ''} · Provider ID{' '}
              <span className="font-mono">{pick.playerId}</span>
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs font-medium text-red-800 dark:text-red-300">
        Action: refresh player identity data, reload the app, then retry provider
        sync. If a player still does not match, add an explicit mapping for the
        provider ID shown above.
      </p>
    </section>
  );
}
