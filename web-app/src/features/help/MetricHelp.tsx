import * as React from 'react';
import { Info, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { METRIC_HELP, type HelpMetric } from './metric-help-content';

export function MetricHelp({
  metric,
  label,
  className,
  context,
}: {
  readonly metric: HelpMetric;
  readonly label?: string;
  readonly className?: string;
  readonly context?: React.ReactNode;
}): React.ReactElement {
  const help = METRIC_HELP[metric];
  const titleId = React.useId();
  const descriptionId = React.useId();
  const [popoverOpen, setPopoverOpen] = React.useState(false);
  const [tooltipOpen, setTooltipOpen] = React.useState(false);
  const suppressTooltip = React.useRef(false);

  return (
    <Popover open={popoverOpen} onOpenChange={(open) => {
      setPopoverOpen(open);
      setTooltipOpen(false);
    }}>
      <Tooltip open={tooltipOpen && !popoverOpen} onOpenChange={(open) => {
        setTooltipOpen(open && !popoverOpen && !suppressTooltip.current);
      }}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              aria-label={`About ${label ?? help.title}`}
              className={cn('metric-help-trigger h-auto min-h-6 min-w-6 gap-1 rounded-sm px-0.5 py-0 text-inherit whitespace-normal has-[>svg]:px-0.5', className)}
              onBlur={() => { suppressTooltip.current = false; }}
              onPointerLeave={() => { suppressTooltip.current = false; }}
            >
              <span className="underline decoration-muted-foreground/40 decoration-dotted underline-offset-4">{label ?? help.title}</span>
              <Info className="size-3 shrink-0 opacity-65" aria-hidden="true" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{help.summary}</TooltipContent>
      </Tooltip>
      <PopoverContent
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onCloseAutoFocus={() => { suppressTooltip.current = true; }}
      >
        <h3 id={titleId} className="pr-8 text-sm font-semibold">{help.title}</h3>
        <p id={descriptionId} className="mt-2 text-sm leading-relaxed">{help.summary}</p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{help.detail}</p>
        {context ? <div className="mt-3 border-t border-border pt-3 text-sm leading-relaxed">{context}</div> : null}
        <PopoverClose asChild>
          <Button type="button" variant="ghost" size="icon-sm" className="absolute right-2 top-2" aria-label="Close explanation">
            <X className="size-4" aria-hidden="true" />
          </Button>
        </PopoverClose>
      </PopoverContent>
    </Popover>
  );
}
