/**
 * Browser gate settings: ports, data source, and the layout thresholds the checks assert.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const WEB_PORT = Number(process.env['BROWSER_GATE_PORT'] ?? 3100);
export const API_PORT = WEB_PORT + 1;
export const ORIGIN = `http://localhost:${String(WEB_PORT)}`;
export const SERVER_START_TIMEOUT_MS = 60_000;
export const MOCK_TIMEOUT_MS = 60_000;
export const ASSISTANT_STATES = ['wait', 'compare', 'roster', 'why'] as const;
export const DESKTOP = 1280;
export const PHONE = 390;
/** Laptop and desktop widths where the split dock's sidebar narrows the player pool most. */
export const POOL_WIDTHS = [1280, 1366, 1440] as const;
/** The pool's optional columns (data-col in DraftPlayerPoolRow) plus Proj; all must fit at POOL_WIDTHS. */
export const POOL_COLUMNS = ['pos', 'adp', 'bye', 'inj', 'vsadp', 'proj'] as const;
/** Widths at which the readiness checklist must keep its copy readable. */
export const NARROW_WIDTHS = [360, 390, 400] as const;
/** Desktop and laptop viewports the draft room and assistant must fit without wrapping or clipping. */
export const LAPTOP_VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
] as const;
/** Pool rows that must be fully visible by default at 1366x768 (board still showing three full rounds). */
export const MIN_POOL_ROWS_AT_1366 = 6;
/**
 * Whole board rounds the default board must show at every laptop and desktop size. Below 900px tall the board
 * compacts its cells to fit three in the same height (1366x768, 1280x800); taller windows give the board more height.
 */
export const MIN_BOARD_ROUNDS = 3;
/** Cheat-sheet names keep at least this width with the tier analysis open or closed. */
export const MIN_TIER_NAME_WIDTH = 120;
/** Extension side panel widths whose turn banner must never clip. */
export const SIDE_PANEL_WIDTHS = [360, 390, 420] as const;
export const MIN_TEXT_CONTRAST = 4.5;
/** Laptop-height viewports whose board must still show three whole rounds late in the draft (pick 11.05). */
export const LATER_ROUND_VIEWPORTS = [{ width: 1280, height: 800 }, { width: 1366, height: 768 }] as const;
export const LATER_ROUND = 11;
/** The Assistant shows this many suggestion cards, all fully visible at 1280x800. */
export const SUGGESTION_CARDS = 4;
/**
 * The analysis's intended height (assistant.css --rec-analysis-height): at most 680px and at least 440px, otherwise
 * what the window leaves below the sticky header (16px above, 16px below), minus the one-line rail summary and its
 * 12px gap below ASSISTANT_RAIL_BREAKPOINT. The tier drawer adds its 36px close row to the same bound.
 */
export const ANALYSIS_MAX_HEIGHT = 680;
export const ANALYSIS_MIN_HEIGHT = 440;
/** The laptop summary above the analysis: next turn and queue, who picks before you, and the roster-context note. */
export const RAIL_SUMMARY_HEIGHT = 48;
export const SIDE_GAP = 12;
export const TIER_CLOSE_HEIGHT = 36;
/** Every chip on a card, verdict included: the verdict and at most one more. */
export const MAX_CARD_CHIPS = 2;
/** Chip-like marks counted on a card: status and verdict chips, badges and position tags. */
export const CARD_CHIP_SELECTOR = '.status-chip, [data-slot="badge"], .position-tag';
/**
 * Suggestion card heights, loaded or loading, closed or after any interaction (draft-design.css): the leader is the
 * list's one large row, and cards 2-4 are compact so the best-available list starts higher.
 */
export const LEAD_CARD_HEIGHT = 104;
export const CARD_HEIGHT = 66;
/** Tab answer visible before scrolling at laptop sizes, for the slot-12 leader (item A9). */
export const MIN_ANSWER_HEIGHT = 220;
/** Whole tier columns visible beside the open analysis at 1280-1440 (item A10). */
export const MIN_TIER_COLUMNS_WITH_ANALYSIS = 4;
/** A deep available player (rank ~400) that only Overall and WR list in a search (R9-4, R9-5). */
export const DEEP_PLAYER = 'Tyrell Shavers';
/** Full cold-load layout shift allowed, measured from navigation start. */
export const MAX_COLD_LOAD_CLS = 0.001;
/** Full pool rows that must stay visible under an open setup checklist. */
export const MIN_POOL_ROWS_WITH_CHECKLIST = 4;
/** The Assistant moves its queue and roster beside the analysis from this width. */
export const ASSISTANT_RAIL_BREAKPOINT = 1600;
/** Chip-like text whose contrast is measured: status and verdict chips, position tags, badges and alerts. */
export const CONTRAST_SELECTOR = '.status-chip, .position-tag, [data-slot="badge"], .rec-alert, .suggestion-key, .draft-turn-banner strong';
export const USE_LOCAL_DATA = process.env['BROWSER_GATE_DATA'] === 'local';
/** Demo data by default; an explicitly set storage mode or data source still wins. */
export const DATA_ENV: Readonly<Record<string, string>> = USE_LOCAL_DATA ? {} : {
  BROWSER_DATA_SOURCE: process.env['BROWSER_DATA_SOURCE'] ?? 'demo',
  VITE_DEMO_MODE: process.env['VITE_DEMO_MODE'] ?? 'true',
  VITE_STORAGE_ACTIVATION: process.env['VITE_STORAGE_ACTIVATION'] ?? 'idb',
};
/** Both themes: every geometry and glance check runs in each (round 12, D25). */
export const THEMES = ['light', 'dark'] as const;
export type GateTheme = (typeof THEMES)[number];
/** Best-available rows are one line: at least this tall (the 40px row floor) and at most ROW_MAX_HEIGHT. */
export const ROW_MIN_HEIGHT = 40;
export const ROW_MAX_HEIGHT = 44;
/** Whole best-available rows on screen before any scrolling, by window height (item 4); none required below 900px. */
export const MIN_POOL_ROWS_ABOVE_FOLD: Readonly<Record<number, number>> = { 900: 1, 1080: 3 };
/** Whole tier columns visible beside the analysis at 1920x1080. */
export const MIN_TIER_COLUMNS_AT_1920 = 5;
