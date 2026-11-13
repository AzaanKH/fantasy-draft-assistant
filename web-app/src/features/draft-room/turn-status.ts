import { createSlotSequence } from '@fantasy-draft/shared/draft';
import type { DraftType } from '@fantasy-draft/shared/sync';
import { getPicksUntilMyTurn } from '@/features/draft-board/on-the-clock-utils';

export interface TurnStatusInput {
  readonly currentPick: number;
  readonly myPickPosition: number;
  readonly totalTeams: number;
  readonly totalRounds: number;
  readonly draftType: DraftType;
  /** Name of the keeper reserved at the current pick when it is the manager's slot; the keeper fills it automatically. */
  readonly keeperAtCurrentPick?: string | null;
}

export type TurnStatus =
  | { readonly kind: 'on-clock'; readonly pickLabel: string; readonly overallPick: number }
  /** The manager's slot, but a reserved keeper fills it, so there is no selection to make. */
  | { readonly kind: 'keeper'; readonly pickLabel: string; readonly overallPick: number; readonly keeperName: string }
  | { readonly kind: 'waiting'; readonly picksUntil: number; readonly pickLabel: string }
  /** The draft continues, but the manager has no picks left. */
  | { readonly kind: 'my-picks-done' }
  | { readonly kind: 'complete' };

/** One source for "is it my turn, and if not, how far away": the side panel and the draft room header both use it. */
export function getTurnStatus(input: TurnStatusInput): TurnStatus {
  const { currentPick, myPickPosition, totalTeams, totalRounds, draftType, keeperAtCurrentPick } = input;
  if (currentPick > totalTeams * totalRounds) return { kind: 'complete' };
  const picksUntil = getPicksUntilMyTurn(currentPick, myPickPosition, totalTeams, totalRounds, draftType);
  if (picksUntil === null) return { kind: 'my-picks-done' };
  const pickLabel = createSlotSequence({ type: draftType, teams: totalTeams, rounds: totalRounds }).label(currentPick);
  if (picksUntil !== 0) return { kind: 'waiting', picksUntil, pickLabel };
  return keeperAtCurrentPick
    ? { kind: 'keeper', pickLabel, overallPick: currentPick, keeperName: keeperAtCurrentPick }
    : { kind: 'on-clock', pickLabel, overallPick: currentPick };
}

export function ordinal(value: number): string {
  const lastTwo = value % 100;
  const suffix = lastTwo >= 11 && lastTwo <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[value % 10] ?? 'th';
  return `${String(value)}${suffix}`;
}

/** Headline and detail for the turn banner. */
export function describeTurnStatus(status: TurnStatus): { readonly headline: string; readonly detail: string | null } {
  switch (status.kind) {
    case 'on-clock': return { headline: "You're on the clock", detail: `Pick ${status.pickLabel} · ${ordinal(status.overallPick)} overall` };
    case 'keeper': return { headline: `Keeper pick ${status.pickLabel}`, detail: `${status.keeperName} fills it automatically` };
    case 'waiting': return { headline: `Your next pick in ${String(status.picksUntil)} ${status.picksUntil === 1 ? 'pick' : 'picks'}`, detail: null };
    case 'my-picks-done': return { headline: 'Your picks are complete', detail: null };
    case 'complete': return { headline: 'Draft complete', detail: null };
  }
}

/**
 * One turn's identity: its state, plus the pick when the turn is yours, so back-to-back picks at a snake turnaround
 * (1.12 then 2.01) are two turns rather than one long one.
 */
export function getTurnKey(status: TurnStatus): string {
  return status.kind === 'on-clock' || status.kind === 'keeper' ? `${status.kind}:${String(status.overallPick)}` : status.kind;
}

/**
 * Screen-reader copy for a turn change (`previous` is the last `getTurnKey`), or null when it should stay silent.
 * Only reaching the clock, a keeper slot, or the end is announced, never each pick while waiting.
 */
export function getTurnAnnouncement(previous: string | null, status: TurnStatus): string | null {
  if (previous === null || previous === getTurnKey(status) || status.kind === 'waiting') return null;
  const { headline, detail } = describeTurnStatus(status);
  return detail ? `${headline}. ${detail}.` : `${headline}.`;
}
