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
  reportThemeToHost(resolvedTheme);
}

/**
 * Inside the extension's side panel, the shell around this frame draws its own loading and error overlays; it is
 * told the resolved theme so they match. Only the theme name is sent, so any embedding origin may receive it.
 */
function reportThemeToHost(resolvedTheme: 'light' | 'dark'): void {
  if (window.parent === window) return;
  try {
    window.parent.postMessage({ type: 'fantasy-draft:theme', theme: resolvedTheme }, '*');
  } catch {
    // A detached or cross-origin-restricted parent cannot be told; the shell falls back to the OS setting.
  }
}

export function persistTheme(theme: ThemeMode): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Theme selection remains active for the current session when storage is unavailable.
  }
}
