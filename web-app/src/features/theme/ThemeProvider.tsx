import * as React from 'react';
import {
  applyTheme,
  persistTheme,
  readStoredTheme,
  type ThemeMode,
} from './theme';

interface ThemeContextValue {
  readonly theme: ThemeMode;
  readonly setTheme: (theme: ThemeMode) => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

export function ThemeProvider({
  children,
  initialTheme,
  persist = true,
}: {
  readonly children: React.ReactNode;
  readonly initialTheme?: ThemeMode;
  readonly persist?: boolean;
}): React.ReactElement {
  const [theme, setTheme] = React.useState<ThemeMode>(
    () => initialTheme ?? readStoredTheme()
  );

  React.useEffect(() => {
    applyTheme(theme);
    if (persist) persistTheme(theme);

    if (theme !== 'system') return undefined;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = (): void => {
      applyTheme('system');
    };
    mediaQuery.addEventListener('change', handleSystemThemeChange);
    return () => {
      mediaQuery.removeEventListener('change', handleSystemThemeChange);
    };
  }, [persist, theme]);

  const value = React.useMemo<ThemeContextValue>(
    () => ({ theme, setTheme }),
    [theme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = React.useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used inside ThemeProvider');
  }
  return context;
}
