import type { SurvivalModelSource } from '@fantasy-draft/shared/league';
import type { Probability } from '@fantasy-draft/shared/units';

/**
 * The chance a player is still there at the manager's next pick, as every surface shows it (pool, suggestion cards,
 * analysis, side panel). Three cases, never conflated: a current estimate; no estimate (the survival model has not
 * run for this player, so the catalog's static figure must not stand in for it); and no further pick to estimate.
 */
export type NextPickAvailability =
  | { readonly kind: 'estimate'; readonly probability: Probability; readonly pickLabel: string | undefined }
  | { readonly kind: 'unestimated' }
  | { readonly kind: 'no-next-pick' };

/** A league-adjusted player, or a recommendation's diagnostics: both carry the survival model's own fields. */
export interface NextPickAvailabilitySource {
  readonly nextPickSurvivalProbability?: Probability | undefined;
  readonly nextPickNumber?: number | undefined;
  readonly nextPickLabel?: string | undefined;
  readonly survivalModelSource?: SurvivalModelSource | undefined;
}

const UNESTIMATED: NextPickAvailability = { kind: 'unestimated' };
const NO_NEXT_PICK: NextPickAvailability = { kind: 'no-next-pick' };

/**
 * Pass a recommendation's diagnostics or a player the survival model adjusted, never a catalog player: the model
 * marks its output with `survivalModelSource`, and a modelled player without a next pick number has no later pick.
 */
export function getNextPickAvailability(source: NextPickAvailabilitySource | undefined): NextPickAvailability {
  if (!source) return UNESTIMATED;
  if (source.survivalModelSource !== undefined && source.nextPickNumber === undefined) return NO_NEXT_PICK;
  const probability = source.nextPickSurvivalProbability;
  if (typeof probability !== 'number' || !Number.isFinite(probability)) return UNESTIMATED;
  return { kind: 'estimate', probability, pickLabel: source.nextPickLabel };
}

/** "72%" for an estimate; an em dash otherwise. */
export function formatAvailabilityPercent(availability: NextPickAvailability): string {
  return availability.kind === 'estimate' ? `${String(Math.round(availability.probability * 100))}%` : '—';
}

/** Why a figure is missing, for a title, screen-reader text or a muted label. Null for an estimate. */
export function describeMissingAvailability(availability: NextPickAvailability): string | null {
  if (availability.kind === 'no-next-pick') return 'No later pick';
  if (availability.kind === 'unestimated') return 'Not estimated';
  return null;
}

/** The estimate's probability, or undefined, for code that takes a plain number (the verdict). */
export function availabilityProbability(availability: NextPickAvailability): Probability | undefined {
  return availability.kind === 'estimate' ? availability.probability : undefined;
}
