import { describe, expect, it } from 'vitest';
import { DEFAULT_ROSTER_REQUIREMENTS, FLEX_GROUPS, type Position, type RosterRequirements } from '@fantasy-draft/shared/league';
import { optimizeLineupUtility } from '@fantasy-draft/shared/draft';
import { buildByeStrip, buildLineup, byeWindow, computeLeagueRanks, ordinal, previewCandidate, rankOffset, type RosterPlayer } from './roster-needs';

const LEAGUE: RosterRequirements = {
  ...DEFAULT_ROSTER_REQUIREMENTS,
  FLEX: { starters: 1, eligiblePositions: [...FLEX_GROUPS.standard] },
  K: { starters: 0, max: 0 },
};

let next = 0;
function p(position: Position, projectedPoints: number, byeWeek = 7): RosterPlayer {
  next += 1;
  return { id: `${position}-${String(next)}`, name: `${position} ${String(projectedPoints)}`, position, projectedPoints, ceilingScore: 0, byeWeek };
}

describe('buildLineup', () => {
  it('orders slots QB, TE, RB pair, WR pair, FLEX and labels repeated slots', () => {
    expect(buildLineup([], LEAGUE).slots.map((slot) => slot.label)).toEqual(['QB', 'TE', 'RB1', 'RB2', 'WR1', 'WR2', 'FLEX']);
  });

  it('seats by projection like the shared optimizer, with the best leftover in FLEX', () => {
    const roster = [p('RB', 150), p('RB', 220), p('RB', 180), p('WR', 200), p('QB', 300), p('QB', 280)];
    const lineup = buildLineup(roster, LEAGUE);
    const seat = (key: string): number | undefined => lineup.slots.find((slot) => slot.key === key)?.player?.projectedPoints;
    expect([seat('RB-0'), seat('RB-1'), seat('FLEX-0'), seat('QB-0'), seat('WR-1')]).toEqual([220, 180, 150, 300, undefined]);
    expect(lineup.bench.map((player) => player.projectedPoints)).toEqual([280]);
    expect(lineup.points).toBe(optimizeLineupUtility(roster, LEAGUE));
  });

  it('uses the league’s real slots: superflex can seat a second QB', () => {
    const superflex: RosterRequirements = { ...LEAGUE, FLEX: { starters: 1, eligiblePositions: [...FLEX_GROUPS.superflex] } };
    const lineup = buildLineup([p('QB', 300), p('QB', 280)], superflex);
    expect(lineup.slots.find((slot) => slot.group === 'FLEX')?.player?.projectedPoints).toBe(280);
  });
});

describe('previewCandidate', () => {
  it('fills an open slot and adds his full projection', () => {
    const roster = [p('WR', 200)];
    const preview = previewCandidate(roster, p('WR', 180), LEAGUE);
    expect(preview.slotKey).toBe('WR-1');
    expect(preview.displaced).toBeNull();
    expect(preview.gain).toBe(180);
  });

  it('upgrades a filled slot and counts only the improvement', () => {
    const roster = [p('QB', 250)];
    const preview = previewCandidate(roster, p('QB', 300), LEAGUE);
    expect(preview.slotKey).toBe('QB-0');
    expect(preview.displaced?.projectedPoints).toBe(250);
    expect(preview.gain).toBe(50);
  });

  it('lands on the bench with no gain when he would not start', () => {
    const preview = previewCandidate([p('TE', 150)], p('TE', 100), { ...LEAGUE, FLEX: { starters: 0, eligiblePositions: [] } });
    expect(preview.slotKey).toBeNull();
    expect(preview.gain).toBe(0);
  });
});

describe('computeLeagueRanks', () => {
  it('ranks your starters at each position against every other team, before and after the pick', () => {
    const teams = [
      [p('WR', 200), p('WR', 190)],
      [p('WR', 180), p('WR', 170)],
      [p('WR', 100)], // mine
      [p('RB', 50)],
    ];
    const candidate = p('WR', 150);
    const ranks = computeLeagueRanks({ teamRosters: teams, myTeamIndex: 2, candidate, requirements: LEAGUE });
    expect(ranks?.teamCount).toBe(4);
    const wr = ranks?.ladders.find((ladder) => ladder.position === 'WR');
    expect(wr).toEqual({ position: 'WR', now: 3, after: 3 });
    // 100 + 150 = 250 passes nobody (350 and 390 lead); a bigger WR moves you up.
    const big = computeLeagueRanks({ teamRosters: teams, myTeamIndex: 2, candidate: p('WR', 260), requirements: LEAGUE });
    expect(big?.ladders.find((ladder) => ladder.position === 'WR')).toEqual({ position: 'WR', now: 3, after: 2 });
    expect(ranks?.ladders.map((ladder) => ladder.position)).toEqual(['QB', 'RB', 'WR', 'TE']);
  });

  it('counts a FLEX starter at his own position', () => {
    const ranks = computeLeagueRanks({ teamRosters: [[p('RB', 100), p('RB', 100), p('RB', 90)], [p('RB', 120), p('RB', 120)]], myTeamIndex: 0, candidate: null, requirements: LEAGUE });
    expect(ranks?.teams[0]?.points.RB).toBe(290);
    expect(ranks?.ladders.find((ladder) => ladder.position === 'RB')?.now).toBe(1);
  });

  it('shares a rank on ties', () => {
    const ranks = computeLeagueRanks({ teamRosters: [[p('QB', 300)], [p('QB', 300)], [p('QB', 200)]], myTeamIndex: 2, candidate: null, requirements: LEAGUE });
    expect(ranks?.ladders.find((ladder) => ladder.position === 'QB')?.now).toBe(3);
    const tied = computeLeagueRanks({ teamRosters: [[p('QB', 300)], [p('QB', 300)], [p('QB', 300)]], myTeamIndex: 2, candidate: null, requirements: LEAGUE });
    expect(tied?.ladders.find((ladder) => ladder.position === 'QB')?.now).toBe(1);
  });

  it('returns null with no league to rank against', () => {
    expect(computeLeagueRanks({ teamRosters: [[p('QB', 300)], [], []], myTeamIndex: 0, candidate: null, requirements: LEAGUE })).toBeNull();
    expect(computeLeagueRanks({ teamRosters: [[p('QB', 300)]], myTeamIndex: 0, candidate: null, requirements: LEAGUE })).toBeNull();
    expect(computeLeagueRanks({ teamRosters: [], myTeamIndex: 0, candidate: null, requirements: LEAGUE })).toBeNull();
  });
});

describe('bye strip', () => {
  it('spans the catalog’s bye window and ignores unknown byes', () => {
    expect(byeWindow([{ byeWeek: 9 }, { byeWeek: 5 }, { byeWeek: 0 }, { byeWeek: 14 }])).toEqual({ first: 5, last: 14 });
    expect(byeWindow([{ byeWeek: 0 }])).toBeNull();
  });

  it('counts starters out each week and names who shares the candidate’s bye', () => {
    const rb = p('RB', 200, 9);
    const wr = p('WR', 180, 9);
    const qb = p('QB', 300, 6);
    const candidate = p('TE', 120, 9);
    const strip = buildByeStrip([rb, wr, qb, candidate], candidate, { first: 5, last: 10 });
    expect(strip.weeks.map((week) => week.out.length)).toEqual([0, 1, 0, 0, 3, 0]);
    expect(strip.clashWith).toEqual([rb, wr]);
    expect(strip.candidateWeek).toBe(9);
  });

  it('reports no clash when the candidate’s bye is unknown', () => {
    const candidate = p('TE', 120, 0);
    expect(buildByeStrip([p('RB', 1, 0), candidate], candidate, { first: 5, last: 6 })).toMatchObject({ clashWith: [], candidateWeek: null });
  });
});

it('formats ranks and track offsets', () => {
  expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
  expect(rankOffset(1, 10)).toBe(0);
  expect(rankOffset(10, 10)).toBe(100);
  expect(rankOffset(5, 9)).toBe(50);
  expect(rankOffset(1, 1)).toBe(0);
});
