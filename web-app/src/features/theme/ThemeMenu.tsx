import * as React from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from './ThemeProvider';
import type { ThemeMode } from './theme';

const THEME_OPTIONS: readonly {
  readonly id: ThemeMode;
  readonly label: string;
  readonly icon: typeof Sun;
}[] = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'System', icon: Monitor },
];

export function ThemeMenu({ compact = false }: {
  readonly compact?: boolean;
}): React.ReactElement {
  const { theme, setTheme } = useTheme();
  const [isOpen, setIsOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const ActiveIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;
  const closeAndRestoreFocus = React.useCallback((): void => {
    setIsOpen(false);
    window.setTimeout(() => { triggerRef.current?.focus(); }, 0);
  }, []);

  React.useEffect(() => {
    if (!isOpen) return undefined;

    const handlePointerDown = (event: PointerEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeAndRestoreFocus();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeAndRestoreFocus, isOpen]);

  return (
    <div ref={menuRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={`Appearance: ${theme}`}
        onClick={() => { setIsOpen((current) => !current); }}
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-lg border border-border/80 bg-card text-sm font-semibold text-muted-foreground shadow-xs transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          compact ? 'size-9' : 'h-9 px-3'
        )}
      >
        <ActiveIcon className="size-4" />
        {compact ? null : <span className="hidden lg:inline">Appearance</span>}
      </button>
      {isOpen ? (
        <div
          role="menu"
          aria-label="Choose appearance"
          className="absolute right-0 z-50 mt-2 w-40 overflow-hidden rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-2xl"
        >
          {THEME_OPTIONS.map((option) => {
            const Icon = option.icon;
            const isSelected = option.id === theme;
            return (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={isSelected}
                onClick={() => {
                  setTheme(option.id);
                  closeAndRestoreFocus();
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isSelected && 'text-emerald-700 dark:text-emerald-300'
                )}
              >
                <Icon className="size-4" />
                <span className="flex-1">{option.label}</span>
                {isSelected ? <Check className="size-4" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
