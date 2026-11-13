import * as React from 'react';

/**
 * Where keys 1-4 act on the suggestion cards. "anywhere": on the clock, from anywhere on the page. "focused": only
 * while the suggestion list (or a card) has focus, for screen-reader and switch users whose own navigation keys
 * would otherwise draft a player. The focused-list shortcuts work in both scopes.
 */
export type SuggestionShortcutScope = 'anywhere' | 'focused';

export const SUGGESTION_SHORTCUT_STORAGE_KEY = 'fantasy-draft:suggestion-shortcut-scope';
const DEFAULT_SCOPE: SuggestionShortcutScope = 'anywhere';

const listeners = new Set<() => void>();
/** The session's choice when storage is unavailable, so the toggle still works until the page reloads. */
let memoryScope: SuggestionShortcutScope | null = null;

function isScope(value: unknown): value is SuggestionShortcutScope {
  return value === 'anywhere' || value === 'focused';
}

export function readSuggestionShortcutScope(): SuggestionShortcutScope {
  try {
    const stored = window.localStorage.getItem(SUGGESTION_SHORTCUT_STORAGE_KEY);
    if (isScope(stored)) return stored;
  } catch {
    // Blocked storage falls back to this session's choice.
  }
  return memoryScope ?? DEFAULT_SCOPE;
}

export function storeSuggestionShortcutScope(scope: SuggestionShortcutScope): void {
  memoryScope = scope;
  try {
    window.localStorage.setItem(SUGGESTION_SHORTCUT_STORAGE_KEY, scope);
  } catch {
    // The in-memory choice still applies for this session.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab changing the preference applies here too.
  const onStorage = (event: StorageEvent): void => { if (event.key === SUGGESTION_SHORTCUT_STORAGE_KEY) listener(); };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage); };
}

export function useSuggestionShortcutScope(): readonly [SuggestionShortcutScope, (scope: SuggestionShortcutScope) => void] {
  const scope = React.useSyncExternalStore(subscribe, readSuggestionShortcutScope, () => DEFAULT_SCOPE);
  return [scope, storeSuggestionShortcutScope];
}
