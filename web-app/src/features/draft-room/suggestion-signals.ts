import type { Player } from '@fantasy-draft/shared/league';
import { getInjuryTag } from '@/lib/player-status';
import { getPlayerRisk } from '@/lib/player-risk';
import type { CardFlag } from './suggestion-card-parts';
import type { ReasonChip, TakeOrWaitVerdict } from './suggestion-reasons';

export interface CardSignalInput {
  readonly playerId: string;
  readonly player: Player | undefined;
  readonly verdict: TakeOrWaitVerdict['kind'] | null;
  readonly reasons: readonly ReasonChip[];
}

export interface CardSignals {
  /** Whether this card shows its verdict chip. */
  readonly showVerdict: boolean;
  /** The one chip beside it, or null. */
  readonly flag: CardFlag | null;
}

/**
 * Which chips each Assistant card shows, chosen across the list so a chip always sets its card apart. A chip every
 * card repeats ("Take now" four times, "Need RB" on a roster that needs everything) tells the manager nothing.
 *
 * - The leader always shows its verdict. Another card shows its verdict only when it differs from the leader's.
 * - An injury or elevated risk always shows: it is about the player, not the comparison.
 * - Otherwise a card shows its first reason whose label no other card carries. A roster need is dropped when every
 *   card fills one. Tier ends is never the flag: the card's line already says "Last WR in Tier 2".
 */
export function selectCardSignals(cards: readonly CardSignalInput[]): ReadonlyMap<string, CardSignals> {
  const leadVerdict = cards[0]?.verdict ?? null;
  const candidates = cards.map((card) => card.reasons.filter((reason) => reason.key !== 'tier-ends'));
  const labelCount = new Map<string, number>();
  candidates.flat().forEach((reason) => { labelCount.set(reason.label, (labelCount.get(reason.label) ?? 0) + 1); });
  const everyCardFillsNeed = cards.length > 1 && candidates.every((reasons) => reasons.some((reason) => reason.key === 'need'));
  return new Map(cards.map((card, index) => {
    const showVerdict = card.verdict !== null && (index === 0 || card.verdict !== leadVerdict);
    return [card.playerId, { showVerdict, flag: selectFlag(card.player, candidates[index] ?? [], labelCount, everyCardFillsNeed) }];
  }));
}

function selectFlag(player: Player | undefined, reasons: readonly ReasonChip[], labelCount: ReadonlyMap<string, number>, everyCardFillsNeed: boolean): CardFlag | null {
  if (player && getInjuryTag(player.newsStatus)) return { kind: 'injury' };
  const risk = player ? getPlayerRisk(player) : null;
  if (risk && risk.level !== 'low') return { kind: 'risk' };
  const chip = reasons.find((reason) => labelCount.get(reason.label) === 1 && !(reason.key === 'need' && everyCardFillsNeed));
  return chip ? { kind: 'reason', chip } : null;
}
