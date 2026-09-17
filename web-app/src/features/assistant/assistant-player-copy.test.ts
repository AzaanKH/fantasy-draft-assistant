import { describe, expect, it } from 'vitest';
import type { Recommendation } from '@fantasy-draft/shared';
import { getAssistantPlayerCopy } from './AssistantPage';

function recommendation(playerId: string, playerName: string): Recommendation {
  return {
    playerId,
    playerName,
    position: 'WR',
    reason: 'Test recommendation',
    score: 100,
  };
}

describe('getAssistantPlayerCopy', () => {
  const preferred = recommendation('preferred', 'Ja\'Marr Chase');

  it('keeps selected-player analysis separate from recommendation status', () => {
    const alternative = recommendation('alternative', 'CeeDee Lamb');

    expect(getAssistantPlayerCopy(alternative, preferred)).toEqual({
      analysisHeading: 'Analysis for CeeDee Lamb',
      recommendationStatus:
        "Recommended for this pick: Ja'Marr Chase. CeeDee Lamb is being reviewed as an alternative.",
    });
  });

  it('identifies the preferred player without generic best-value language', () => {
    expect(getAssistantPlayerCopy(preferred, preferred)).toEqual({
      analysisHeading: "Analysis for Ja'Marr Chase",
      recommendationStatus: "Recommended for this pick: Ja'Marr Chase.",
    });
  });
});
