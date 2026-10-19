import type { DraftType } from './sync.js';

export interface DraftFormat {
  readonly type: DraftType;
  readonly teams: number;
  readonly rounds: number;
}

const slotWitness: unique symbol = Symbol('draft-order-slot');

export interface SlotRef {
  readonly [slotWitness]: true;
  readonly order: string;
  readonly kind: 'ordered-allocation' | 'legacy-auction-nomination';
  readonly pick: number;
  readonly round: number;
  readonly teamIndex: number;
  readonly label: string;
  readonly direction: 'forward' | 'reverse';
  readonly endsRound: boolean;
}

export interface SlotSequence {
  readonly id: string;
  readonly slots: readonly SlotRef[];
  at(pick: number): SlotRef;
  /** Display location, including the completion sentinel after the final allocated slot. */
  label(pick: number): string;
  forTeamRound(teamIndex: number, round: number): SlotRef;
  nextForTeam(teamIndex: number, fromPick: number, occupied?: ReadonlySet<number>): SlotRef | null;
  picksUntilTurn(teamIndex: number, fromPick: number): number | null;
}

const sequences = new Map<string, SlotSequence>();
const MAX_CACHED_SEQUENCES = 128;

export function createSlotSequence(format: DraftFormat): SlotSequence {
  const { type, teams, rounds } = format;
  if (!Number.isInteger(teams) || teams < 1 || !Number.isInteger(rounds) || rounds < 1) {
    throw new RangeError('Draft order requires positive integer teams and rounds.');
  }
  const id = `${type}:${teams}:${rounds}`;
  const cached = sequences.get(id);
  if (cached) return cached;
  const label = (pick: number): string => {
    if (!Number.isSafeInteger(pick) || pick < 1) throw new RangeError('Pick must be a positive integer.');
    return `${Math.ceil(pick / teams)}.${String((pick - 1) % teams + 1).padStart(2, '0')}`;
  };
  const byTeam: SlotRef[][] = Array.from({ length: teams }, () => []);
  const slots = Object.freeze(Array.from({ length: teams * rounds }, (_, index): SlotRef => {
    const round = Math.floor(index / teams) + 1;
    const position = index % teams;
    // Auction nominations retain the web app's existing snake presentation.
    const direction = type !== 'linear' && round % 2 === 0 ? 'reverse' : 'forward';
    const teamIndex = direction === 'reverse' ? teams - position - 1 : position;
    const slot = Object.freeze({
      [slotWitness]: true,
      order: id,
      kind: type === 'auction' ? 'legacy-auction-nomination' : 'ordered-allocation',
      pick: index + 1,
      round,
      teamIndex,
      label: label(index + 1),
      direction,
      endsRound: position === teams - 1,
    } satisfies SlotRef);
    byTeam[teamIndex]?.push(slot);
    return slot;
  }));
  const at = (pick: number): SlotRef => {
    const slot = slots[pick - 1];
    if (!Number.isInteger(pick) || !slot) throw new RangeError(`Pick ${pick} is outside this draft order.`);
    return slot;
  };
  const nextForTeam = (teamIndex: number, fromPick: number, occupied?: ReadonlySet<number>): SlotRef | null =>
    byTeam[teamIndex]?.find(slot => slot.pick >= fromPick && !occupied?.has(slot.pick)) ?? null;
  const sequence: SlotSequence = Object.freeze({
    id,
    label,
    slots,
    at,
    forTeamRound(teamIndex: number, round: number): SlotRef {
      const slot = byTeam[teamIndex]?.[round - 1];
      if (!Number.isInteger(teamIndex) || !Number.isInteger(round) || !slot) {
        throw new RangeError('Team or round is outside this draft order.');
      }
      return slot;
    },
    nextForTeam,
    picksUntilTurn(teamIndex: number, fromPick: number): number | null {
      const slot = nextForTeam(teamIndex, fromPick);
      return slot === null ? null : slot.pick - fromPick;
    },
  });
  if (sequences.size === MAX_CACHED_SEQUENCES) {
    const oldestId = sequences.keys().next().value;
    if (oldestId !== undefined) sequences.delete(oldestId);
  }
  sequences.set(id, sequence);
  return sequence;
}
