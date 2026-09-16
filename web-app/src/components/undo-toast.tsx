import * as React from 'react';
import { RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface UndoToastInput {
  readonly message: string;
  readonly onUndo: () => void;
}

interface UndoToastState extends UndoToastInput {
  readonly id: number;
  readonly phase: 'open' | 'closing';
}

const UndoToastContext = React.createContext<((toast: UndoToastInput) => void) | null>(null);

export function UndoToastProvider({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  const [toast, setToast] = React.useState<UndoToastState | null>(null);
  const nextId = React.useRef(0);

  const dismiss = React.useCallback(() => {
    setToast((current) => current ? { ...current, phase: 'closing' } : null);
    window.setTimeout(() => {
      setToast((current) => current?.phase === 'closing' ? null : current);
    }, 180);
  }, []);

  const showToast = React.useCallback((input: UndoToastInput) => {
    nextId.current += 1;
    setToast({ ...input, id: nextId.current, phase: 'open' });
  }, []);

  React.useEffect(() => {
    if (!toast || toast.phase !== 'open') return;
    const timeout = window.setTimeout(dismiss, 4_500);
    return () => { window.clearTimeout(timeout); };
  }, [dismiss, toast]);

  return (
    <UndoToastContext.Provider value={showToast}>
      {children}
      {toast ? (
        <div
          key={toast.id}
          className="undo-toast fixed bottom-4 left-1/2 z-[100] flex w-[min(calc(100%-2rem),420px)] -translate-x-1/2 items-center gap-3 rounded-lg border border-border/80 bg-popover px-3 py-2.5 text-popover-foreground shadow-xl shadow-black/10"
          data-state={toast.phase}
          role="status"
          aria-live="polite"
        >
          <span className="min-w-0 flex-1 text-sm font-medium">{toast.message}</span>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-emerald-700 dark:text-emerald-300"
            onClick={() => {
              toast.onUndo();
              dismiss();
            }}
          >
            <RotateCcw className="size-3.5" /> Undo
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground"
            aria-label="Dismiss"
            onClick={dismiss}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ) : null}
    </UndoToastContext.Provider>
  );
}

export function useUndoToast(): (toast: UndoToastInput) => void {
  const context = React.useContext(UndoToastContext);
  if (!context) {
    throw new Error('useUndoToast must be used inside UndoToastProvider');
  }
  return context;
}
