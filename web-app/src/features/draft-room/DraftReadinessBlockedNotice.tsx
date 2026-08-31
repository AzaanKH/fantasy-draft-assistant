import { CircleAlert } from 'lucide-react';
import {
  formatDraftReadinessTimestamp,
  type DraftReadinessReport,
} from '@fantasy-draft/shared';
import { cn } from '@/lib/utils';

export function DraftReadinessBlockedNotice({
  readiness,
  className,
}: {
  readonly readiness: DraftReadinessReport;
  readonly className?: string;
}): React.ReactElement {
  return (
    <section
      aria-labelledby="recommendations-blocked-heading"
      className={cn(
        'rounded-xl border border-red-500/45 bg-red-500/[0.08] p-4 shadow-sm',
        className
      )}
      role="alert"
    >
      <div className="flex items-start gap-2">
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-red-700 dark:text-red-300" />
        <div>
          <h2 id="recommendations-blocked-heading" className="text-sm font-bold text-red-800 dark:text-red-300">
            Recommendations blocked by Core Draft Data
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            The draft state remains visible, but recommendations stay off until these inputs are corrected.
          </p>
        </div>
      </div>
      <ul className="mt-3 space-y-2">
        {readiness.productBlockingFailures.map((item) => (
          <li key={item.key} className="rounded-md border border-red-500/20 bg-background/75 px-3 py-2 text-xs">
            <div className="font-semibold">{item.label}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {item.sourceLabel} · {item.timestampLabel}{' '}
              <span className="font-mono tabular-nums">
                {formatDraftReadinessTimestamp(item.timestamp)}
              </span>
            </div>
            <p className="mt-1 leading-relaxed text-muted-foreground">{item.message}</p>
            <p className="mt-1 font-medium text-red-800 dark:text-red-300">
              Action: {item.correctiveAction}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
