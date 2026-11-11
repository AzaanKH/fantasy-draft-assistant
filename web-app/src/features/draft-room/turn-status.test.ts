import { describe, expect, it } from 'vitest';
import { describeTurnStatus, getTurnAnnouncement, getTurnKey, getTurnStatus, ordinal } from './turn-status';

const base = { myPickPosition: 4, totalTeams: 10, totalRounds: 14, draftType: 'snake' } as const;

describe('getTurnStatus', () => {
  it('is on the clock at my slot', () => {
    expect(getTurnStatus({ ...base, currentPick: 4 })).toEqual({ kind: 'on-clock', pickLabel: '1.04', overallPick: 4 });
  });

  it('counts picks until my next snake turn', () => {
    expect(getTurnStatus({ ...base, currentPick: 1 })).toMatchObject({ kind: 'waiting', picksUntil: 3 });
    // Round 2 snakes back: slot 4 picks 17th overall.
    expect(getTurnStatus({ ...base, currentPick: 5 })).toMatchObject({ kind: 'waiting', picksUntil: 12 });
  });

  it('separates finishing my picks from finishing the draft', () => {
    // Slot 4's last pick in a 10-team, 14-round snake is 137 overall.
    expect(getTurnStatus({ ...base, currentPick: 138 })).toEqual({ kind: 'my-picks-done' });
    expect(describeTurnStatus({ kind: 'my-picks-done' }).headline).toBe('Your picks are complete');
  });

  it('reports completion past the last pick', () => {
    expect(getTurnStatus({ ...base, currentPick: 141 })).toEqual({ kind: 'complete' });
  });
});

describe('describeTurnStatus', () => {
  it('formats each state', () => {
    expect(describeTurnStatus({ kind: 'on-clock', pickLabel: '1.04', overallPick: 4 })).toEqual({ headline: "You're on the clock", detail: 'Pick 1.04 · 4th overall' });
    expect(describeTurnStatus({ kind: 'waiting', picksUntil: 1, pickLabel: '1.03' }).headline).toBe('Your next pick in 1 pick');
    expect(describeTurnStatus({ kind: 'waiting', picksUntil: 6, pickLabel: '1.01' }).headline).toBe('Your next pick in 6 picks');
    expect(describeTurnStatus({ kind: 'keeper', pickLabel: '2.04', overallPick: 17, keeperName: 'Ada Back' })).toEqual({ headline: 'Keeper pick 2.04', detail: 'Ada Back fills it automatically' });
    expect(describeTurnStatus({ kind: 'complete' }).headline).toBe('Draft complete');
  });

  it.each([[1, '1st'], [2, '2nd'], [3, '3rd'], [4, '4th'], [11, '11th'], [12, '12th'], [13, '13th'], [21, '21st'], [112, '112th']])('ordinal %d', (value, expected) => {
    expect(ordinal(value)).toBe(expected);
  });
});

describe('keeper slots', () => {
  const base = { myPickPosition: 4, totalTeams: 10, totalRounds: 14, draftType: 'snake' as const };
  it('is not on the clock when a reserved keeper fills my pick', () => {
    expect(getTurnStatus({ ...base, currentPick: 4, keeperAtCurrentPick: 'Ada Back' })).toEqual({ kind: 'keeper', pickLabel: '1.04', overallPick: 4, keeperName: 'Ada Back' });
    expect(getTurnStatus({ ...base, currentPick: 4, keeperAtCurrentPick: null }).kind).toBe('on-clock');
  });
});

describe('getTurnAnnouncement', () => {
  const clock = { kind: 'on-clock', pickLabel: '1.04', overallPick: 4 } as const;
  const waiting = { kind: 'waiting', picksUntil: 3, pickLabel: '1.01' } as const;
  it('announces only a change of state, never the first render or each waiting pick', () => {
    expect(getTurnAnnouncement(null, clock)).toBeNull();
    expect(getTurnAnnouncement('waiting', waiting)).toBeNull();
    expect(getTurnAnnouncement(getTurnKey(clock), waiting)).toBeNull();
    expect(getTurnAnnouncement(getTurnKey(clock), clock)).toBeNull();
    expect(getTurnAnnouncement('waiting', clock)).toBe("You're on the clock. Pick 1.04 · 4th overall.");
    expect(getTurnAnnouncement('waiting', { kind: 'my-picks-done' })).toBe('Your picks are complete.');
    expect(getTurnAnnouncement('my-picks-done', { kind: 'complete' })).toBe('Draft complete.');
  });

  it('announces the second of back-to-back turns at the snake turnaround (1.12 then 2.01)', () => {
    const first = { kind: 'on-clock', pickLabel: '1.12', overallPick: 12 } as const;
    const second = { kind: 'on-clock', pickLabel: '2.01', overallPick: 13 } as const;
    expect(getTurnAnnouncement(getTurnKey(first), second)).toBe("You're on the clock. Pick 2.01 · 13th overall.");
  });
});
