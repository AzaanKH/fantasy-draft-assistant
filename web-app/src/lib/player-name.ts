import type { Position } from '@fantasy-draft/shared/league';

/**
 * A name for narrow places: "Christian McCaffrey" → "C. McCaffrey"; suffixes stay ("M. Harrison Jr."), and an
 * already-initialled first name ("A.J. Brown") is kept. A team defense reads "BAL D/ST", never "B. Defense".
 */
export function shortPlayerName(name: string, position?: Position, team?: string): string {
  const trimmed = name.trim();
  if (position === 'DEF') return `${team || trimmed.split(/\s+/)[0] || trimmed} D/ST`;
  const [first, ...rest] = trimmed.split(/\s+/);
  if (!first || rest.length === 0 || first.includes('.')) return trimmed;
  return `${first.charAt(0)}. ${rest.join(' ')}`;
}

/** Longest short name a ~76px board cell shows whole; longer ones drop the initial ("Smith-Njigba"). */
const BOARD_NAME_MAX = 12;

/** The board's narrow-column name: the short name, or the surname alone when even that is too long. */
export function boardPlayerName(name: string, position?: Position, team?: string): string {
  const short = shortPlayerName(name, position, team);
  if (short.length <= BOARD_NAME_MAX || position === 'DEF') return short;
  const parts = short.split(' ');
  return parts.length > 1 && parts[0]?.endsWith('.') ? parts.slice(1).join(' ') : short;
}
