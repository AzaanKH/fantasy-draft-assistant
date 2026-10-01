import type { CSSProperties, ReactNode } from 'react';
import { Toaster } from 'sonner';
import { useTheme } from '@/features/theme/ThemeProvider';

/** One notification stack for the workspace, assistant, and companion. */
export function NotificationProvider({ children }: { readonly children: ReactNode }): React.ReactElement {
  const { theme } = useTheme();
  return <>
    {children}
    <Toaster
      theme={theme}
      position="bottom-right"
      visibleToasts={3}
      closeButton
      duration={6000}
      mobileOffset={16}
      containerAriaLabel="Draft notifications"
      style={{
        '--normal-bg': 'var(--color-popover)',
        '--normal-text': 'var(--color-popover-foreground)',
        '--normal-border': 'var(--color-border)',
      } as CSSProperties}
      toastOptions={{
        closeButtonAriaLabel: 'Dismiss notification',
        actionButtonStyle: { background: 'var(--color-primary)', color: 'var(--color-primary-foreground)' },
      }}
    />
  </>;
}
