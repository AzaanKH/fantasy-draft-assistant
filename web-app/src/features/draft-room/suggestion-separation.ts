import type { Recommendation } from '@fantasy-draft/shared/draft';

/**
 * Per-card value comparison: each card against #1, and #1 against #2, so all four cards carry a different line.
 * Measured in value over replacement (projected points above a replacement starter), an absolute, lens-independent
 * fact: recommendation scores are lens-specific and uncalibrated (Best Player scores are negated expert ranks), so
 * the cards never call a pick "clear" or "close" from them.
 *
 * Null whenever either player has no value, or there is no other card to compare with.
 */
export interface GapToTop {
  /** This player's value minus the compared card's, rounded to whole points. */
  readonly vorDelta: number;
  /** The card compared against: 1 for every card after the first, 2 for the first. */
  readonly versus: 1 | 2;
}

type GapInput = Pick<Recommendation, 'playerId'> & { readonly valueOverReplacement: number | undefined };

const isValue = (value: number | undefined): value is number => value !== undefined && Number.isFinite(value);

export function getGapsToTop(suggestions: readonly GapInput[]): ReadonlyMap<string, GapToTop | null> {
  const gaps = new Map<string, GapToTop | null>();
  const [top, second] = suggestions;
  suggestions.forEach((suggestion, index) => {
    const other = index === 0 ? second : top;
    const vor = suggestion.valueOverReplacement;
    const otherVor = other?.valueOverReplacement;
    gaps.set(suggestion.playerId, !other || !isValue(vor) || !isValue(otherVor)
      ? null
      : { vorDelta: Math.round(vor - otherVor) || 0, versus: index === 0 ? 2 : 1 });
  });
  return gaps;
}

/** "+52 pts over #2", "12 pts behind #1", or "Even with #1". */
export function formatGapToTop(gap: GapToTop): string {
  const versus = `#${String(gap.versus)}`;
  if (gap.vorDelta === 0) return `Even with ${versus}`;
  const points = Math.abs(gap.vorDelta);
  const unit = points === 1 ? 'pt' : 'pts';
  return gap.vorDelta > 0 ? `+${String(points)} ${unit} over ${versus}` : `${String(points)} ${unit} behind ${versus}`;
}

/** The tooltip that says what the points are, so the card's line stays free of model terms. */
export const GAP_BASIS = 'Projected season points over a fill-in starter at each position, compared between the two cards.';
