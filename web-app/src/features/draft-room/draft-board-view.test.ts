import { describe, expect, it } from 'vitest';
import {
  getCenteredTeamSlice,
  getDraftBoardCurrentView,
} from './draft-board-view';

describe('getCenteredTeamSlice', () => {
  it('centers the active team when the board has room on both sides', () => {
    expect(getCenteredTeamSlice(4, 10)).toEqual([3, 4, 5]);
  });

  it('keeps a contiguous three-team slice at either board edge', () => {
    expect(getCenteredTeamSlice(0, 10)).toEqual([0, 1, 2]);
    expect(getCenteredTeamSlice(9, 10)).toEqual([7, 8, 9]);
  });

  it('shows every team in leagues smaller than the requested slice', () => {
    expect(getCenteredTeamSlice(1, 2)).toEqual([0, 1]);
  });
});

describe('getDraftBoardCurrentView', () => {
  it('tracks the active snake slot and the selection window through My Team', () => {
    expect(getDraftBoardCurrentView({
      currentPick: 7,
      myPickPosition: 1,
      totalTeams: 10,
      totalRounds: 15,
    })).toEqual({
      activeRound: 1,
      activeTeamIndex: 6,
      mobileTeamIndices: [5, 6, 7],
      upcomingMyPickNumber: 20,
    });
  });

  it('ends the selection window on the active pick when My Team is on the clock', () => {
    expect(getDraftBoardCurrentView({
      currentPick: 20,
      myPickPosition: 1,
      totalTeams: 10,
      totalRounds: 15,
    }).upcomingMyPickNumber).toBe(20);
  });

  it('returns a stable My Team slice after the draft is complete', () => {
    expect(getDraftBoardCurrentView({
      currentPick: 151,
      myPickPosition: 5,
      totalTeams: 10,
      totalRounds: 15,
    })).toEqual({
      activeRound: null,
      activeTeamIndex: 4,
      mobileTeamIndices: [3, 4, 5],
      upcomingMyPickNumber: null,
    });
  });
});
