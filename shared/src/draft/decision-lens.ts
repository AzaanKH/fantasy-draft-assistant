import type { DecisionLens } from '../draft.js';

/** Every Decision Lens, in toggle order. The first is the default. */
export const DECISION_LENSES = ['ranked-fit', 'best-pick', 'best-player'] as const satisfies readonly DecisionLens[];

/**
 * Ranked Fit is the default ordering. Best Pick regains the default only by beating
 * Ranked Fit on the full 2026 season under the CI Best Pick gate
 * (docs/draft-approach.md#default-decision-lens).
 */
export const DEFAULT_DECISION_LENS: DecisionLens = 'ranked-fit';

export interface SavedDecisionLens {
  readonly decisionLens?: DecisionLens;
  /** The default in force when the session was written; absent on sessions saved before Ranked Fit. */
  readonly decisionLensDefault?: DecisionLens;
}

/**
 * The lens a saved session restores. Sessions written before Ranked Fit always stored a
 * lens, and Best Pick was then the default, so a stored Best Pick there is not a choice
 * and moves to the new default. Best Player was always chosen and is kept.
 */
export function resolveSavedDecisionLens(saved: SavedDecisionLens | null | undefined): DecisionLens {
  const lens = saved?.decisionLens;
  if (lens === undefined) return DEFAULT_DECISION_LENS;
  if (saved?.decisionLensDefault === undefined && lens === 'best-pick') return DEFAULT_DECISION_LENS;
  return lens;
}

/** The display name of each Decision Lens. */
export const DECISION_LENS_LABELS: Readonly<Record<DecisionLens, string>> = {
  'ranked-fit': 'Ranked Fit',
  'best-pick': 'Best Pick',
  'best-player': 'Best Player',
};
