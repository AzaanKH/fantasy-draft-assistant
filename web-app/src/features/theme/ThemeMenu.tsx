import * as React from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { IconTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useTheme } from './ThemeProvider';

const THEME_OPTIONS = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'System', icon: Monitor },
] as const;

type ThemeId = (typeof THEME_OPTIONS)[number]['id'];

function isThemeId(value: string): value is ThemeId {
  return THEME_OPTIONS.some((option) => option.id === value);
}

/**
 * Appearance picker built on the Radix menu primitive, which supplies the
 * menu keyboard contract: arrows and Home/End move, typeahead jumps,
 * Enter/Space select, Escape closes, and focus returns to the trigger.
 */
export function ThemeMenu({ compact = false }: {
  readonly compact?: boolean;
}): React.ReactElement {
  const { theme, setTheme } = useTheme();
  const ActiveIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;

  return (
    <DropdownMenu.Root modal={false}>
      <IconTooltip label="Appearance">
      <DropdownMenu.Trigger
        aria-label={`Appearance: ${theme}`}
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-lg border border-border/80 bg-card text-sm font-semibold text-muted-foreground shadow-xs transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:text-foreground',
          compact ? 'size-9' : 'h-9 px-3'
        )}
      >
        <ActiveIcon className="size-4" />
        {compact ? null : <span className="draft-header-label hidden lg:inline">Appearance</span>}
      </DropdownMenu.Trigger>
      </IconTooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          aria-label="Choose appearance"
          className="z-50 w-40 overflow-hidden rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-2xl"
        >
          <DropdownMenu.RadioGroup
            value={theme}
            onValueChange={(value) => { if (isThemeId(value)) setTheme(value); }}
          >
            {THEME_OPTIONS.map((option) => {
              const Icon = option.icon;
              return (
                <DropdownMenu.RadioItem
                  key={option.id}
                  value={option.id}
                  className={cn(
                    'flex w-full cursor-default select-none items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm outline-none transition-colors data-[highlighted]:bg-muted',
                    'data-[state=checked]:text-primary'
                  )}
                >
                  <Icon className="size-4" />
                  <span className="flex-1">{option.label}</span>
                  <DropdownMenu.ItemIndicator>
                    <Check className="size-4" />
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              );
            })}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
