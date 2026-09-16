import * as React from 'react';
import { ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

interface SelectProps extends Omit<
  React.ComponentProps<'select'>,
  'children' | 'onChange' | 'value'
> {
  readonly value: string;
  readonly options: readonly SelectOption[];
  readonly onValueChange: (value: string) => void;
}

/**
 * A compact native select. Native controls keep keyboard and screen-reader
 * behavior while avoiding a floating-positioning runtime in the draft bundle.
 */
function Select({
  className,
  options,
  onValueChange,
  value,
  ...props
}: SelectProps): React.ReactElement {
  return (
    <span className={cn('relative inline-flex h-9 min-w-32 text-sm', className)}>
      <select
        data-slot="select"
        className="h-full w-full appearance-none rounded-md border border-input bg-transparent py-2 pl-3 pr-9 text-[inherit] shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
        value={value}
        onChange={(event) => { onValueChange(event.target.value); }}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </span>
  );
}

export { Select };
