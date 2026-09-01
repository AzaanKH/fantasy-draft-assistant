import type { DetectedPick } from '../shared/types';

const PICK_SELECTORS = [
  '[class*="pick"]',
  '[class*="Pick"]',
  '[class*="player"]',
  '[class*="Player"]',
  '[class*="drafted"]',
  '[class*="Drafted"]',
  '[data-player]',
  '[data-pick]',
] as const;
const PICK_SELECTOR = PICK_SELECTORS.join(',');

/**
 * Parse a Sleeper pick announcement such as
 * "Patrick Mahomes 1.1 QB - KC".
 */
export function parsePickFromText(
  text: string,
  timestamp: number = Date.now()
): DetectedPick | null {
  const pickPattern =
    /^(.+?)\s+(\d+\.\d+)\s+(QB|RB|WR|TE|K|DEF|D\/ST)\s*-?\s*(\w+)?$/i;
  const match = text.trim().match(pickPattern);

  if (!match) {
    return null;
  }

  const [, playerName, pickNumber, position, team] = match;
  return {
    playerName: playerName?.trim() ?? '',
    teamName: team?.trim() ?? '',
    pickNumber,
    position: position?.toUpperCase(),
    timestamp,
  };
}

export function getPickKey(pick: DetectedPick): string {
  return `${pick.playerName}-${pick.pickNumber ?? ''}-${pick.position ?? ''}`;
}

export function extractPicksFromDocument(
  document: Document,
  timestamp: number = Date.now()
): DetectedPick[] {
  const picks: DetectedPick[] = [];

  for (const selector of PICK_SELECTORS) {
    for (const element of document.querySelectorAll(selector)) {
      const text = element.textContent?.trim() ?? '';
      const pick = parsePickFromText(text, timestamp);
      if (pick?.playerName) {
        picks.push(pick);
      }

      if (!text.toLowerCase().includes('drafted')) {
        continue;
      }

      if (element.querySelector(PICK_SELECTOR)) {
        continue;
      }

      const draftedMatch = text.match(/^(.+?)\s+drafted\s+(.+)$/i);
      const teamName = draftedMatch?.[1];
      const playerName = draftedMatch?.[2];
      if (teamName && playerName) {
        picks.push({
          playerName: playerName.trim(),
          teamName: teamName.trim(),
          timestamp,
        });
      }
    }
  }

  return picks;
}
