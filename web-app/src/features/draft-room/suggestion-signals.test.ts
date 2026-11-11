import { describe, expect, it } from 'vitest';
import type { ReasonChip } from './suggestion-reasons';
import { selectCardSignals, type CardSignalInput } from './suggestion-signals';

const need = (position: string): ReasonChip => ({ key: 'need', label: `Need ${position}`, tone: 'neutral', detail: '' });
const value: ReasonChip = { key: 'value', label: 'Value +5', tone: 'ok', detail: '' };
const bye: ReasonChip = { key: 'bye-conflict', label: 'Bye conflict', tone: 'warn', detail: '' };
const tierEnds: ReasonChip = { key: 'tier-ends', label: 'Tier ends', tone: 'warn', detail: '' };
const card = (playerId: string, verdict: CardSignalInput['verdict'], reasons: readonly ReasonChip[]): CardSignalInput => ({ playerId, player: undefined, verdict, reasons });
const shown = (cards: readonly CardSignalInput[]): string[] => {
  const signals = selectCardSignals(cards);
  return cards.map((item) => {
    const signal = signals.get(item.playerId);
    return `${signal?.showVerdict ? 'verdict' : '-'}|${signal?.flag?.kind === 'reason' ? signal.flag.chip.label : signal?.flag?.kind ?? '-'}`;
  });
};

describe('chips chosen across the four cards', () => {
  it('shows a shared verdict on the leader only, and drops a need every card fills', () => {
    expect(shown([
      card('a', 'take-now', [need('RB')]), card('b', 'take-now', [need('RB')]), card('c', 'take-now', [need('RB')]), card('d', 'take-now', [need('WR')]),
    ])).toEqual(['verdict|-', '-|-', '-|-', '-|-']);
  });

  it('keeps a verdict that differs from the leader, so the odd one out stands out', () => {
    expect(shown([card('a', 'take-now', []), card('b', 'can-wait', []), card('c', 'take-now', []), card('d', 'likely-available', [])]))
      .toEqual(['verdict|-', 'verdict|-', '-|-', 'verdict|-']);
  });

  it('drops a reason other cards repeat and falls through to one only this card has', () => {
    expect(shown([
      card('a', 'take-now', [tierEnds, bye]), card('b', 'take-now', [need('WR')]), card('c', 'take-now', [need('WR')]), card('d', 'take-now', [need('WR'), value]),
    ])).toEqual(['verdict|Bye conflict', '-|-', '-|-', '-|Value +5']);
  });

  it('keeps needs at different positions when not every card fills one', () => {
    expect(shown([card('a', 'take-now', [need('RB')]), card('b', 'take-now', [value]), card('c', 'take-now', [need('TE')]), card('d', null, [])]))
      .toEqual(['verdict|Need RB', '-|Value +5', '-|Need TE', '-|-']);
  });

  it('shows no verdict where there is none, even on the leader', () => {
    expect(shown([card('a', null, []), card('b', 'take-now', [])])).toEqual(['-|-', 'verdict|-']);
  });
});
