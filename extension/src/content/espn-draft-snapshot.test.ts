import { describe, expect, it } from 'vitest';
import {
  buildEspnDraftSnapshot,
  getEspnDraftFrameCommand,
} from './espn-draft-snapshot';

function createDraftStore() {
  return {
    // ESPN uses this for roster slots, not the number of fantasy teams.
    draftSlotCount: 16,
    draftType: 1,
    drafted: false,
    state: 8,
    teamId: 12,
    teams: [
      { id: 9, draftPosition: 1 },
      { id: 10, draftPosition: 2 },
      { id: 11, draftPosition: 3 },
      { id: 12, draftPosition: 4 },
    ],
    picks: [
      {
        pickNumber: 1,
        round: { id: 1 },
        winningTeam: { id: 9, draftPosition: 1 },
        rosterSlot: { id: 2 },
        player: {
          id: 1001,
          fullName: 'Alpha Runner',
          defaultPositionId: 2,
          proTeam: { abbrev: 'BUF' },
        },
      },
      {
        pickNumber: 2,
        round: { id: 1 },
        winningTeam: { id: 10, draftPosition: 2 },
        player: {
          id: -1,
        },
      },
      {
        pickNumber: 3,
        round: { id: 1 },
        winningTeam: { id: 11, draftPosition: 3 },
        player: {
          id: 1003,
          firstName: 'Bravo',
          lastName: 'Receiver',
          defaultPosition: { abbreviation: 'WR' },
          proTeamId: 6,
        },
      },
      { pickNumber: 4, player: { id: -1 } },
      { pickNumber: 5, player: { id: -1 } },
      { pickNumber: 6, player: { id: -1 } },
      { pickNumber: 7, player: { id: -1 } },
      { pickNumber: 8, player: { id: -1 } },
    ],
  };
}

describe('ESPN page snapshot normalization', () => {
  it('sanitizes the page store into canonical picks and metadata', () => {
    const snapshot = buildEspnDraftSnapshot(
      createDraftStore(),
      'https://fantasy.espn.com/football/draft?leagueId=4242&seasonId=2026&teamId=12&memberId=private',
      1234
    );

    expect(snapshot).toMatchObject({
      observedAt: 1234,
      myDraftSlot: 4,
      draft: {
        provider: 'espn',
        draftId: '4242',
        providerKey: '2026:4242',
        status: 'drafting',
        type: 'snake',
        settings: { teams: 4, rounds: 2 },
      },
    });
    expect(snapshot?.picks).toEqual([
      expect.objectContaining({
        pickNumber: 1,
        playerId: '1001',
        playerName: 'Alpha Runner',
        position: 'RB',
        nflTeam: 'BUF',
        draftSlot: 1,
        source: 'espn-extension',
      }),
      expect.objectContaining({
        pickNumber: 3,
        playerId: '1003',
        playerName: 'Bravo Receiver',
        position: 'WR',
        nflTeam: 'DAL',
        draftSlot: 3,
      }),
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('memberId');
    expect(JSON.stringify(snapshot)).not.toContain('private');
  });

  it('normalizes salary-cap drafts and defense names', () => {
    const store = createDraftStore();
    const snapshot = buildEspnDraftSnapshot(
      {
        ...store,
        draftType: 4,
        picks: [
          {
            overallPickNumber: 1,
            teamId: 9,
            playerId: 2001,
            player: {
              id: 2001,
              fullName: 'Pittsburgh Steelers D/ST',
              defaultPositionId: 16,
              proTeamId: 23,
            },
          },
        ],
      },
      'https://fantasy.espn.com/football/draft?leagueId=99',
      5000
    );

    expect(snapshot?.draft.type).toBe('auction');
    expect(snapshot?.picks[0]).toMatchObject({
      playerName: 'Pittsburgh Steelers',
      position: 'DEF',
      nflTeam: 'PIT',
    });
  });

  it('normalizes ESPN team aliases used by local player identity matching', () => {
    const snapshot = buildEspnDraftSnapshot(
      {
        draftType: 1,
        state: 8,
        teamId: 1,
        teams: [{ id: 1, draftPosition: 0 }],
        picks: [
          {
            pickNumber: 1,
            teamId: 1,
            player: {
              id: 3121422,
              fullName: 'Terry McLaurin',
              defaultPositionId: 3,
              proTeam: { abbrev: 'WSH' },
            },
          },
        ],
      },
      'https://fantasy.espn.com/football/draft?leagueId=99',
      5000
    );

    expect(snapshot?.picks[0]).toMatchObject({
      playerName: 'Terry McLaurin',
      nflTeam: 'WAS',
    });
  });

  it('converts ESPN zero-based draft positions into one-based slots', () => {
    const store = createDraftStore();
    const snapshot = buildEspnDraftSnapshot(
      {
        ...store,
        teams: [
          { id: 9, draftPosition: 0 },
          { id: 10, draftPosition: 1 },
          { id: 11, draftPosition: 2 },
          { id: 12, draftPosition: 3 },
        ],
      },
      'https://fantasy.espn.com/football/draft?leagueId=4242&seasonId=2026&teamId=12',
      5000
    );

    expect(snapshot?.myDraftSlot).toBe(4);
    expect(snapshot?.picks[0]?.draftSlot).toBe(1);
    expect(snapshot?.picks[1]?.draftSlot).toBe(3);
  });

  it('keeps page-world snapshots free of league-profile runtime dependencies', () => {
    const activeLeagueId = '1652783544';
    const teams = Array.from({ length: 14 }, (_, index) => ({
      id: index + 1,
      draftPosition: index + 1,
    }));
    const picks = Array.from({ length: 14 * 17 }, (_, index) => ({
      pickNumber: index + 1,
      player: { id: -1 },
    }));
    const snapshot = buildEspnDraftSnapshot(
      {
        draftType: 1,
        drafted: false,
        state: 1,
        teamId: 12,
        teams,
        picks,
      },
      `https://fantasy.espn.com/football/draft?leagueId=${activeLeagueId}&seasonId=2026&teamId=12`,
      6000
    );

    expect(snapshot?.draft).toMatchObject({
      leagueId: activeLeagueId,
      settings: { teams: 14, rounds: 17 },
    });
    expect(snapshot?.draft.leagueSettings).toBeUndefined();
  });

  it('only schedules snapshots for state-changing protocol commands', () => {
    expect(getEspnDraftFrameCommand('SELECTED 3 4426502 4 {opaque-actor}')).toBe(
      'SELECTED'
    );
    expect(getEspnDraftFrameCommand('SOLD 8 4258173 4 25 0')).toBe('SOLD');
    expect(getEspnDraftFrameCommand('UNDONE 12')).toBe('UNDONE');
    expect(getEspnDraftFrameCommand('INIT opaque-base64')).toBe('INIT');
    expect(getEspnDraftFrameCommand('CLOCK 1 9727 7')).toBeNull();
    expect(getEspnDraftFrameCommand('JOIN private-token')).toBeNull();
  });
});
