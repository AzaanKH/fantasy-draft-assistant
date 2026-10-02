import { describe, expect, it } from 'vitest';
import {
  isDraftMetadata,
  isEspnDraftSnapshot,
  type DraftMetadata,
  type DraftPickEvent,
  type EspnDraftSnapshot,
} from './index.js';

const draft: DraftMetadata = {
  provider: 'espn',
  draftId: '4242',
  providerKey: 'espn:4242',
  status: 'drafting',
  type: 'snake',
  settings: { teams: 10, rounds: 14, pickTimer: 90 },
  draftOrder: null,
};

function pick(overrides: Partial<DraftPickEvent> = {}): DraftPickEvent {
  return {
    draftId: '4242',
    pickNumber: 1,
    round: 1,
    rosterId: null,
    draftSlot: 1,
    teamIndex: 0,
    playerId: 'espn-1',
    playerName: 'Player One',
    position: 'RB',
    nflTeam: 'DET',
    isKeeper: false,
    source: 'espn-extension',
    confidence: 'confirmed',
    observedAt: 1_000,
    ...overrides,
  };
}

function snapshot(overrides: Partial<EspnDraftSnapshot> = {}): EspnDraftSnapshot {
  return { draft, picks: [pick()], observedAt: 1_000, ...overrides };
}

describe('ESPN snapshot validation', () => {
  it('accepts a well-formed observation with an optional draft slot', () => {
    expect(isEspnDraftSnapshot(snapshot())).toBe(true);
    expect(isEspnDraftSnapshot(snapshot({ myDraftSlot: 10 }))).toBe(true);
    expect(isEspnDraftSnapshot(snapshot({ picks: [] }))).toBe(true);
  });

  it('rejects metadata from another provider', () => {
    expect(isDraftMetadata({ ...draft, provider: 'sleeper' })).toBe(true);
    expect(isEspnDraftSnapshot(snapshot({ draft: { ...draft, provider: 'sleeper' } }))).toBe(false);
  });

  it.each([
    ['another draft', { draftId: '9999' }],
    ['a non-extension source', { source: 'sleeper-api' as const }],
    ['a pick past the end of the draft', { pickNumber: 141 }],
    ['a round past the configured rounds', { round: 15 }],
    ['a slot past the configured teams', { draftSlot: 11 }],
    ['a team index past the configured teams', { teamIndex: 10 }],
    ['an unknown position', { position: 'LB' as never }],
    ['an oversized player name', { playerName: 'x'.repeat(257) }],
  ])('rejects picks from %s', (_label, overrides) => {
    expect(isEspnDraftSnapshot(snapshot({ picks: [pick(overrides)] }))).toBe(false);
  });

  it('rejects more picks than the draft can hold', () => {
    const smallDraft = { ...draft, settings: { teams: 2, rounds: 1, pickTimer: 90 } };
    const picks = [1, 2, 3].map((pickNumber) => pick({ pickNumber, draftSlot: 1, teamIndex: 0 }));
    expect(isEspnDraftSnapshot({ draft: smallDraft, picks, observedAt: 1_000 })).toBe(false);
  });

  it('rejects draft slots outside the league and non-finite observation times', () => {
    expect(isEspnDraftSnapshot(snapshot({ myDraftSlot: 0 }))).toBe(false);
    expect(isEspnDraftSnapshot(snapshot({ myDraftSlot: 11 }))).toBe(false);
    expect(isEspnDraftSnapshot(snapshot({ observedAt: Number.NaN }))).toBe(false);
  });

  it('rejects oversized league dimensions and malformed draft orders', () => {
    expect(isEspnDraftSnapshot(snapshot({ draft: { ...draft, settings: { teams: 33, rounds: 14, pickTimer: 90 } } }))).toBe(false);
    expect(isEspnDraftSnapshot(snapshot({ draft: { ...draft, draftOrder: { owner: 33 } } }))).toBe(false);
    expect(isEspnDraftSnapshot(snapshot({ draft: { ...draft, draftOrder: { owner: 3 } } }))).toBe(true);
  });

  it('rejects non-object input', () => {
    for (const value of [null, undefined, 'snapshot', 42, []]) {
      expect(isEspnDraftSnapshot(value)).toBe(false);
    }
  });
});
