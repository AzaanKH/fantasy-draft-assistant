import * as React from 'react';
import type { Player } from '@fantasy-draft/shared/league';
import { usePrefersReducedMotion } from '@/components/motion';
import type { NextPickAvailability } from '@/lib/next-pick-availability';
import type { DraftPick } from '@fantasy-draft/shared/draft';
import { useDraftState } from '@/workspace/WorkspaceProvider';

/** Leave and settle animations stay under 200ms (see .draft-pool-row-leaving in draft-design.css). */
export const PICK_LANDED_MS = 180;
/** The roster slot's highlight: within the 200ms limit every UI transition keeps (only the turn pulse is longer). */
export const SLOT_FILLED_MS = 200;

export interface LeavingPoolRow {
  readonly player: Player;
  /** The row's last virtual offset, where its ghost fades out. */
  readonly start: number;
  /** The figure the row showed a moment ago: the pick that drafted the player also drops them from the estimates. */
  readonly availability: NextPickAvailability;
}

/** Which draft the history belongs to: the mode plus the provider session (or this device's local draft). */
export function useDraftSessionKey(): string {
  return useDraftState((state) => `${state.sessionMode}:${state.liveSession ? `${state.liveSession.provider}/${state.liveSession.draftId}` : 'local'}`);
}

type PickRef = Pick<DraftPick, 'pickNumber' | 'playerId'>;

/**
 * The pick that just landed: exactly one pick appended to the same session's history, every earlier pick kept. Null
 * for anything else: a history loaded from storage (none to many picks at once), a switch to another session or mode,
 * an undo, a reset or a rewrite. A load that adds exactly one pick to the same session is indistinguishable from a
 * pick and still counts.
 */
export function getLandedPick<T extends PickRef>(
  previous: { readonly sessionKey: string; readonly history: readonly PickRef[] },
  next: { readonly sessionKey: string; readonly history: readonly T[] }
): T | null {
  if (previous.sessionKey !== next.sessionKey || next.history.length !== previous.history.length + 1) return null;
  const key = (pick: PickRef): string => `${String(pick.pickNumber)}\u0000${pick.playerId}`;
  const kept = new Set(next.history.map(key));
  if (!previous.history.every((pick) => kept.has(key(pick)))) return null;
  const before = new Set(previous.history.map(key));
  return next.history.find((pick) => !before.has(key(pick))) ?? null;
}

/**
 * The pick that just landed in this session (getLandedPick), derived during render so the frame that shows the pick
 * can also start its motion. It stays the same object until the history or session changes again.
 */
export function useLandedPick<T extends PickRef>(history: readonly T[], sessionKey: string): T | null {
  const [tracked, setTracked] = React.useState<{ readonly history: readonly T[]; readonly sessionKey: string; readonly landed: T | null }>({ history, sessionKey, landed: null });
  if (tracked.history !== history || tracked.sessionKey !== sessionKey) {
    const landed = getLandedPick(tracked, { sessionKey, history });
    setTracked({ history, sessionKey, landed });
    return landed;
  }
  return tracked.landed;
}

const UNESTIMATED: NextPickAvailability = { kind: 'unestimated' };
const NO_AVAILABILITY: ReadonlyMap<string, NextPickAvailability> = new Map();

/**
 * The pool row of a player who was just drafted, kept as a ghost for PICK_LANDED_MS so it can fade out while the
 * rows below slide up. It is derived during render (not in an effect), so the frame that moves the rows also turns
 * on their transition. Nothing is kept under reduced motion.
 */
export function useLeavingPoolRow({ rows, starts, draftedPlayerIds, landedPlayerId, availabilityById = NO_AVAILABILITY }: {
  readonly rows: readonly { readonly player: Player }[];
  /**
   * The player of the pick that just landed (useLandedPick). Only that row leaves with motion: a history load or a
   * session switch drafts many players at once, or none in this session, and animates nothing.
   */
  readonly landedPlayerId: string | null;
  /** Each rendered row's virtual offset by player id, from the previous render. */
  readonly starts: ReadonlyMap<string, number>;
  readonly draftedPlayerIds: ReadonlySet<string>;
  readonly availabilityById?: ReadonlyMap<string, NextPickAvailability>;
}): LeavingPoolRow | null {
  const reduceMotion = usePrefersReducedMotion();
  // The estimates as of the previous commit and the one before: the render that sees the row leave already has the
  // new estimates, which no longer hold the drafted player.
  const history = React.useRef({ latest: availabilityById, previous: availabilityById });
  React.useEffect(() => {
    if (history.current.latest !== availabilityById) history.current = { latest: availabilityById, previous: history.current.latest };
  }, [availabilityById]);
  // Compared by ids, not by reference, so a recomputed but identical list never counts as a change.
  const key = rows.map((row) => row.player.id).join('|');
  const [tracked, setTracked] = React.useState<{ readonly key: string; readonly rows: typeof rows; readonly leaving: LeavingPoolRow | null }>({ key, rows, leaving: null });
  if (tracked.key !== key) {
    let leaving: LeavingPoolRow | null = null;
    if (!reduceMotion) {
      const current = new Set(rows.map((row) => row.player.id));
      for (const row of tracked.rows) {
        const start = starts.get(row.player.id);
        if (row.player.id === landedPlayerId && !current.has(row.player.id) && draftedPlayerIds.has(row.player.id) && start !== undefined) {
          const id = row.player.id;
          leaving = { player: row.player, start, availability: history.current.latest.get(id) ?? history.current.previous.get(id) ?? UNESTIMATED };
          break;
        }
      }
    }
    setTracked({ key, rows, leaving });
  }
  const leaving = tracked.leaving;
  React.useEffect(() => {
    if (!leaving) return undefined;
    const timer = window.setTimeout(() => { setTracked((current) => ({ ...current, leaving: null })); }, PICK_LANDED_MS);
    return () => { window.clearTimeout(timer); };
  }, [leaving]);
  return leaving;
}

/**
 * The player id that just joined `ids` (a newly filled roster slot), for SLOT_FILLED_MS; null under reduced motion.
 * Only a pick landing counts: exactly one new id, none removed, within the same draft session (`sessionKey`).
 * Switching to another saved draft, an undo or a reset replaces the roster and flashes nothing.
 */
export function useJustAdded(ids: readonly string[], sessionKey: string): string | null {
  const reduceMotion = usePrefersReducedMotion();
  const key = ids.join('|');
  const [tracked, setTracked] = React.useState<{ readonly key: string; readonly sessionKey: string; readonly added: string | null }>({ key, sessionKey, added: null });
  if (tracked.key !== key || tracked.sessionKey !== sessionKey) {
    const previous = tracked.key ? tracked.key.split('|') : [];
    const current = new Set(ids);
    const newIds = ids.filter((id) => !previous.includes(id));
    const keptAll = previous.every((id) => current.has(id));
    const added = !reduceMotion && tracked.sessionKey === sessionKey && keptAll && newIds.length === 1 ? newIds[0] ?? null : null;
    setTracked({ key, sessionKey, added });
  }
  const added = tracked.added;
  React.useEffect(() => {
    if (!added) return undefined;
    const timer = window.setTimeout(() => { setTracked((current) => ({ ...current, added: null })); }, SLOT_FILLED_MS);
    return () => { window.clearTimeout(timer); };
  }, [added]);
  return added;
}
