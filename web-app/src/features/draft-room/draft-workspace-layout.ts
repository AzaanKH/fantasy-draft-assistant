const BOARD_HEIGHT_STORAGE_KEY = 'draft-board-height';

/**
 * Fallback for --board-default-height where styles are unavailable. The real default, including the laptop-height
 * values that show two or three full rounds, is the CSS custom property in draft-design.css.
 */
export const DEFAULT_BOARD_HEIGHT = 320;
/** Keeps the team header and one round of picks visible. */
export const MIN_BOARD_HEIGHT = 160;
/** Keeps the player toolbar and a few rows visible below the board. */
export const MIN_DOCK_HEIGHT = 260;

export function clampBoardHeight(height: number, maxHeight: number): number {
  return Math.round(Math.min(Math.max(height, MIN_BOARD_HEIGHT), Math.max(MIN_BOARD_HEIGHT, maxHeight)));
}

/** The height the user dragged the board to, or null when they never did (the default then follows the window). */
export function readStoredBoardHeight(): number | null {
  try {
    const raw = window.localStorage.getItem(BOARD_HEIGHT_STORAGE_KEY);
    const stored = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(stored) && stored >= MIN_BOARD_HEIGHT && stored <= 2000 ? stored : null;
  } catch {
    return null;
  }
}

/** Forgets the user's height, so the board follows the window's default again. */
export function clearStoredBoardHeight(): void {
  try {
    window.localStorage.removeItem(BOARD_HEIGHT_STORAGE_KEY);
  } catch {
    // Nothing was stored.
  }
}

export function storeBoardHeight(height: number): void {
  try {
    window.localStorage.setItem(BOARD_HEIGHT_STORAGE_KEY, String(height));
  } catch {
    // Resizing still works for the session when storage is unavailable.
  }
}
