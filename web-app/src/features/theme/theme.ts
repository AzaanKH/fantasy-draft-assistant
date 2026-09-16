export type ThemeMode = 'light' | 'dark' | 'system';

const THEME_STORAGE_KEY = 'fantasy-draft-theme';

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function readStoredTheme(): ThemeMode {
  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(storedTheme) ? storedTheme : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme: ThemeMode): void {
  const systemIsDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const resolvedTheme = theme === 'system'
    ? systemIsDark ? 'dark' : 'light'
    : theme;
  const root = document.documentElement;

  root.classList.toggle('dark', resolvedTheme === 'dark');
  root.classList.toggle('light', resolvedTheme === 'light');
  root.dataset.theme = theme;
  root.style.colorScheme = resolvedTheme;
}

export function persistTheme(theme: ThemeMode): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Theme selection remains active for the current session when storage is unavailable.
  }
}
