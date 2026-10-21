import type { DraftSelection } from './derive-draft.js';

/** Keeper slots are captured when a command accepts the supply, before later format changes. */
interface ReservedSlots {
  readonly keeperSlots: readonly number[];
  readonly totalPicks: number;
}

export type CursorAnchor =
  | { readonly kind: 'start' }
  | ({ readonly kind: 'provider'; readonly nextPickNumber: number } & ReservedSlots)
  | { readonly kind: 'branch'; readonly pickNumber: number }
  | { readonly kind: 'reopen'; readonly pickNumber: number }
  | ({ readonly kind: 'first-open' } & ReservedSlots)
  | ({ readonly kind: 'past-keepers'; readonly fromPick: number } & ReservedSlots)
  | { readonly kind: 'carry'; readonly pickNumber: number };

/** A cursor-setting command and the history prefix it accepted. Later appends advance from it. */
export interface DraftProgress {
  readonly anchor: CursorAnchor;
  readonly historyLength: number;
  /** Pending keepers occupy rosters but pause sequential mock consumption at their slot. */
  readonly keeperPhase: 'pending-consumption' | 'reserved';
}

export function deriveDraftCursor(history: readonly DraftSelection[], progress: DraftProgress): number {
  const { anchor, historyLength } = progress;
  let cursor: number;
  switch (anchor.kind) {
    case 'start': cursor = 1; break;
    case 'branch': cursor = anchor.pickNumber; break;
    case 'reopen': cursor = Math.max(1, anchor.pickNumber); break;
    case 'carry': cursor = anchor.pickNumber; break;
    case 'provider':
    case 'past-keepers': {
      cursor = anchor.kind === 'provider'
        ? Math.min(anchor.totalPicks + 1, Math.max(1, Math.round(anchor.nextPickNumber)))
        : anchor.fromPick;
      const reserved = new Set(anchor.keeperSlots);
      while (cursor <= anchor.totalPicks && reserved.has(cursor)) cursor += 1;
      break;
    }
    case 'first-open': {
      const occupied = new Set(anchor.keeperSlots);
      for (const pick of history.slice(0, historyLength)) occupied.add(pick.pickNumber);
      cursor = 1;
      while (cursor <= anchor.totalPicks && occupied.has(cursor)) cursor += 1;
      break;
    }
    default: {
      const exhaustive: never = anchor;
      return exhaustive;
    }
  }
  for (const pick of history.slice(historyLength)) cursor = Math.max(cursor, pick.pickNumber + 1);
  return cursor;
}
