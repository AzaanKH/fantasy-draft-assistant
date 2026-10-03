import { DEFAULT_ROSTER_REQUIREMENTS, type Position } from '@fantasy-draft/shared';
import { describe, expect, it } from 'vitest';

import {
  countTeamsNeeding,
  getAlertSignals,
  getAssistantDraftMode,
  getSyncStatus,
  getPickWindow,
  getUpcomingTeamPicks,
} from './assistant-context';

const emptyRoster = (): Record<Position, string[]> => ({ QB: [], RB: [], WR: [], TE: [], K: [], DEF: [] });

describe('getPickWindow', () => {
  it('looks to the following pick when the manager is on the clock', () => {
    // 10-team snake, slot 5: picks 5, 16, 25.
    expect(getPickWindow(16, 10, 15, 5, 'snake')).toEqual({
      currentPick: 16,
      onClock: true,
      nextPick: 25,
      picksBetween: [17, 18, 19, 20, 21, 22, 23, 24],
    });
  });

  it('looks to the upcoming pick when another team is on the clock, like Return Probability', () => {
    expect(getPickWindow(12, 10, 15, 5, 'snake')).toEqual({
      currentPick: 12,
      onClock: false,
      nextPick: 16,
      picksBetween: [12, 13, 14, 15],
    });
  });

  it('has no next pick after the manager’s final selection', () => {
    expect(getPickWindow(145, 10, 15, 5, 'snake')).toEqual({ currentPick: 145, onClock: true, nextPick: null, picksBetween: [146, 147, 148, 149, 150] });
  });
});

describe('getUpcomingTeamPicks', () => {
  it('groups both picks of each turn-around team and lists open starters', () => {
    const teamRosters = Array.from({ length: 10 }, emptyRoster);
    teamRosters[3] = { ...emptyRoster(), RB: ['a', 'b'], QB: ['c'] };
    const teams = getUpcomingTeamPicks({
      picks: [17, 18, 19, 20, 21, 22, 23, 24],
      totalTeams: 10,
      draftType: 'snake',
      teamRosters,
      rosterRequirements: DEFAULT_ROSTER_REQUIREMENTS,
      draftHistory: [{ teamIndex: 3, teamName: 'Silver Surfers' }],
    });

    expect(teams.map((team) => [team.teamName, team.pickLabels])).toEqual([
      ['Silver Surfers', ['2.07', '3.04']],
      ['Team 3', ['2.08', '3.03']],
      ['Team 2', ['2.09', '3.02']],
      ['Team 1', ['2.10', '3.01']],
    ]);
    expect(teams[0]?.openStarters).toEqual(['WR', 'TE']);
    expect(countTeamsNeeding(teams, 'RB')).toBe(3);
  });
});

describe('getAlertSignals', () => {
  const rosteredPlayers = [{ id: 'chase', name: "Ja'Marr Chase", position: 'WR' as const, byeWeek: 10 }];

  it('labels bye overlap at the same position, falling ADP and a position run', () => {
    expect(getAlertSignals({
      player: { id: 'tee', position: 'WR', byeWeek: 10, consensusAdp: 12.4 },
      rosteredPlayers,
      recentPicks: [{ position: 'QB' }, { position: 'WR' }, { position: 'WR' }, { position: 'RB' }, { position: 'WR' }],
      currentPick: 16,
    })).toEqual([
      "Bye 10 · same as Ja'Marr Chase",
      '4 picks past ADP',
      'WR run · 3 of last 5 picks',
    ]);
  });

  it('omits signals whose data is missing or below the display threshold', () => {
    expect(getAlertSignals({
      player: { id: 'rb', position: 'RB', byeWeek: 10, consensusAdp: undefined },
      rosteredPlayers,
      recentPicks: [{ position: 'RB' }, { position: 'RB' }],
      currentPick: 16,
    })).toEqual([]);
    expect(getAlertSignals({ player: undefined, rosteredPlayers, recentPicks: [], currentPick: 16 })).toEqual([]);
  });
});

describe('draft mode and sync status', () => {
  it('advises in Companion, records in Manual Continuity and drafts only in a mock', () => {
    expect(getAssistantDraftMode('live', 'confirmed')).toBe('companion');
    expect(getAssistantDraftMode('live', 'manual-continuity')).toBe('manual-continuity');
    expect(getAssistantDraftMode('mock', 'disconnected')).toBe('mock');
    expect(getAssistantDraftMode('setup', 'disconnected')).toBe('preview');
  });

  it('names the provider, the last confirmed pick and its age', () => {
    const base = { provider: 'sleeper' as const, lastConfirmedPickNumber: 15, lastSyncAgeMs: 2_000, totalTeams: 10 };
    expect(getSyncStatus({ ...base, mode: 'companion', synchronizationState: 'confirmed' }))
      .toEqual({ tone: 'ok', label: 'Synced with Sleeper · last pick 2.05 · 2s ago' });
    expect(getSyncStatus({ ...base, mode: 'companion', synchronizationState: 'delayed' }).tone).toBe('warn');
    expect(getSyncStatus({ ...base, mode: 'manual-continuity', synchronizationState: 'manual-continuity' }))
      .toEqual({ tone: 'lost', label: 'Sleeper sync unavailable · picks are provisional' });
    expect(getSyncStatus({ ...base, mode: 'mock', synchronizationState: 'disconnected' }).label).toBe('Local mock · no provider sync');
  });
});
