import * as React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useSuggestionShortcutScope, type SuggestionShortcutScope } from './suggestion-shortcut-preference';

const SCOPE_OPTIONS: readonly { readonly id: SuggestionShortcutScope; readonly label: string; readonly detail: string }[] = [
  { id: 'anywhere', label: 'On the clock, anywhere', detail: 'While you are on the clock, 1 to 4 work from anywhere on the page.' },
  { id: 'focused', label: 'Only when the list is focused', detail: 'Keys act only after you move focus to the suggestion list, so screen-reader and switch navigation keys never draft a player.' },
];

/**
 * "Press 1–4" beside the suggestions heading. It opens the number-key preference: on the clock anywhere (the
 * default) or only with the list focused. The focused-list shortcuts always work.
 */
export function SuggestionShortcutHint({ className }: { readonly className?: string }): React.ReactElement {
  const [scope, setScope] = useSuggestionShortcutScope();
  const groupName = React.useId();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={cn('suggestion-shortcut-hint', className)} aria-label="Press 1–4: number-key shortcut settings"
          title={scope === 'anywhere' ? 'On the clock, press 1 to 4 anywhere on the page to act on that card. Otherwise focus the list first.' : 'Focus the suggestion list, then press 1 to 4 to act on that card.'}>
          Press <kbd>1–4</kbd>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 text-xs">
        <fieldset>
          <legend className="text-sm font-semibold">Number-key shortcuts</legend>
          <p className="mt-1 text-muted-foreground">Keys 1 to 4 take that card&apos;s action: Draft, Record pick or Queue.</p>
          <div className="mt-3 space-y-2">
            {SCOPE_OPTIONS.map((option) => (
              <label key={option.id} className="flex cursor-pointer items-start gap-2">
                <input type="radio" name={groupName} className="mt-0.5 accent-primary" value={option.id} checked={scope === option.id}
                  onChange={() => { setScope(option.id); }} />
                <span>
                  <span className="block font-semibold">{option.label}</span>
                  <span className="block text-muted-foreground">{option.detail}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </PopoverContent>
    </Popover>
  );
}
