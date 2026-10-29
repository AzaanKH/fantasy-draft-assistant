import { decodeEspnDraftSnapshot, isDraftMetadata, isEspnDraftSnapshot } from './catalog/sync-decoders.js';
import { DEFAULT_ROSTER_REQUIREMENTS } from './draft.js';
import { DEFAULT_SCORING_RULES } from './league/scoring.js';
import { createDefaultLeagueSettings, type LeagueSettings } from './league-settings.js';
import { describe, expect, it } from 'vitest';
import {
  type DraftMetadata,
  type DraftPickEvent,
  type EspnDraftSnapshot,
} from './sync.js';

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
    ['a non-extension source', { source: 'sleeper-api' }],
    ['a pick past the end of the draft', { pickNumber: 141 }],
    ['a round past the configured rounds', { round: 15 }],
    ['a slot past the configured teams', { draftSlot: 11 }],
    ['a team index past the configured teams', { teamIndex: 10 }],
    ['an unknown position', { position: 'LB' }],
    ['an oversized player name', { playerName: 'x'.repeat(257) }],
  ])('rejects picks from %s', (_label, overrides) => {
    expect(isEspnDraftSnapshot({ ...snapshot(), picks: [{ ...pick(), ...overrides }] })).toBe(false);
  });

  it('rejects more picks than the draft can hold', () => {
    const smallDraft = { ...draft, settings: { teams: 2, rounds: 1, pickTimer: 90 } };
    const picks = [1, 2, 1].map((pickNumber) => pick({ pickNumber, draftSlot: 1, teamIndex: 0 }));
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

  it.each([
    ['snapshot', (value: Record<string, unknown>) => ({ ...value, swid: '{AUTH}' })],
    ['draft', (value: Record<string, unknown>) => ({ ...value, draft: { ...draft, espnS2: 'cookie' } })],
    ['draft settings', (value: Record<string, unknown>) => ({ ...value, draft: { ...draft, settings: { ...draft.settings, memberId: 'member' } } })],
    ['pick', (value: Record<string, unknown>) => ({ ...value, picks: [{ ...pick(), memberId: '{MEMBER}' }] })],
  ])('rejects undeclared %s fields such as auth tokens, member IDs, or raw payloads', (_label, extend) => {
    const tainted = extend(snapshot());
    expect(isEspnDraftSnapshot(tainted)).toBe(false);
    expect(() => decodeEspnDraftSnapshot(tainted)).toThrow();
  });

  it('decodes a well-formed observation to exactly its declared fields', () => {
    expect(decodeEspnDraftSnapshot(snapshot({ myDraftSlot: 3 }))).toEqual(snapshot({ myDraftSlot: 3 }));
  });

  it('accepts the league profile the background attaches before publishing', () => {
    const profiled = snapshot({ draft: { ...draft, leagueId: '4242', leagueSettings: createDefaultLeagueSettings(1_000) } });
    expect(decodeEspnDraftSnapshot(profiled)).toEqual(profiled);
  });

  it.each([
    ['league settings', (settings: LeagueSettings) => ({ ...settings, espnS2: 'secret' })],
    ['a roster requirement', (settings: LeagueSettings) => ({
      ...settings, rosterRequirements: { ...DEFAULT_ROSTER_REQUIREMENTS, QB: { ...DEFAULT_ROSTER_REQUIREMENTS.QB, rawSocket: { auth: 'secret' } } },
    })],
    ['the flex requirement', (settings: LeagueSettings) => ({
      ...settings, rosterRequirements: { ...DEFAULT_ROSTER_REQUIREMENTS, FLEX: { ...DEFAULT_ROSTER_REQUIREMENTS.FLEX, memberId: '{MEMBER}' } },
    })],
    ['scoring rules', (settings: LeagueSettings) => ({ ...settings, scoringRules: { ...DEFAULT_SCORING_RULES, swid: '{AUTH}' } })],
    ['a numeric scoring group', (settings: LeagueSettings) => ({
      ...settings, scoringRules: { ...DEFAULT_SCORING_RULES, passing: { ...DEFAULT_SCORING_RULES.passing, memberId: 42 } },
    })],
    ['the points-allowed tiers', (settings: LeagueSettings) => ({
      ...settings,
      scoringRules: {
        ...DEFAULT_SCORING_RULES,
        defense: { ...DEFAULT_SCORING_RULES.defense, pointsAllowed: { ...DEFAULT_SCORING_RULES.defense.pointsAllowed, memberId: 12345 } },
      },
    })],
    ['a raw scoring value', (settings: LeagueSettings) => ({ ...settings, rawScoringSettings: { pass_td: { auth: 'secret' } } })],
  ])('rejects undeclared fields inside %s', (_label, extend) => {
    const tainted = { ...snapshot(), draft: { ...draft, leagueSettings: extend(createDefaultLeagueSettings(1_000)) } };
    expect(isEspnDraftSnapshot(tainted)).toBe(false);
    expect(() => decodeEspnDraftSnapshot(tainted)).toThrow();
  });

  it('keeps raw scoring settings open to any provider key with a numeric value', () => {
    const settings = { ...createDefaultLeagueSettings(1_000), rawScoringSettings: { pass_td: 4, yds_allow_550p: -5 } };
    const profiled = snapshot({ draft: { ...draft, leagueSettings: settings } });
    expect(decodeEspnDraftSnapshot(profiled)).toEqual(profiled);
  });

  it('rejects non-object input', () => {
    for (const value of [null, undefined, 'snapshot', 42, []]) {
      expect(isEspnDraftSnapshot(value)).toBe(false);
    }
  });
});
