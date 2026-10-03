const BOARD_HEIGHT_STORAGE_KEY = 'draft-board-height';

export const DEFAULT_BOARD_HEIGHT = 320;
/** Keeps the team header and one round of picks visible. */
export const MIN_BOARD_HEIGHT = 160;
/** Keeps the player toolbar and a few rows visible below the board. */
export const MIN_DOCK_HEIGHT = 260;

export function clampBoardHeight(height: number, maxHeight: number): number {
  return Math.round(Math.min(Math.max(height, MIN_BOARD_HEIGHT), Math.max(MIN_BOARD_HEIGHT, maxHeight)));
}

export function readStoredBoardHeight(): number {
  try {
    const stored = Number(window.localStorage.getItem(BOARD_HEIGHT_STORAGE_KEY));
    return Number.isFinite(stored) && stored >= MIN_BOARD_HEIGHT && stored <= 2000
      ? stored
      : DEFAULT_BOARD_HEIGHT;
  } catch {
    return DEFAULT_BOARD_HEIGHT;
  }
}

export function storeBoardHeight(height: number): void {
  try {
    window.localStorage.setItem(BOARD_HEIGHT_STORAGE_KEY, String(height));
  } catch {
    // Resizing still works for the session when storage is unavailable.
  }
}
