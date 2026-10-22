import type { DraftSelection } from './derive-draft.js';

/** Keeper slots are captured when a command accepts the supply, before later format changes. */
interface ReservedSlots {
  readonly keeperSlots: readonly number[];
  readonly totalPicks: number;
}

/** These commands pause on an unrecorded keeper slot until its selection is consumed. */
type PendingKeeperConsumption =
  | { readonly kind: 'start' }
  | { readonly kind: 'branch'; readonly pickNumber: number }
  | { readonly kind: 'reopen'; readonly pickNumber: number }
  | { readonly kind: 'carry'; readonly pickNumber: number };

type ReservedKeeperSupply =
  | ({ readonly kind: 'provider'; readonly nextPickNumber: number } & ReservedSlots)
  | ({ readonly kind: 'first-open' } & ReservedSlots)
  | ({ readonly kind: 'past-keepers'; readonly fromPick: number } & ReservedSlots);

export type CursorAnchor = PendingKeeperConsumption | ReservedKeeperSupply;

/** A cursor-setting command and the history prefix it accepted. Later appends advance from it. */
export interface DraftProgress {
  readonly anchor: CursorAnchor;
  readonly historyLength: number;
  readonly historyOrder?: 'pick';
}

export function deriveDraftCursor(history: readonly DraftSelection[], progress: DraftProgress): number {
  if (progress.historyOrder === 'pick') history = [...history].sort((left, right) => left.pickNumber - right.pickNumber);
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
