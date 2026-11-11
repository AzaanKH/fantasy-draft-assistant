import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AssistantRailSummary, UPCOMING_NEEDS_NOTE, UpcomingPicks, describeUpcomingNeeds, groupUpcomingNeeds } from './AssistantRail';
import { formatNextTurn, getPickWindow, picksUntilTurn } from './assistant-context';

const team = (teamIndex: number, openStarters: readonly ('QB' | 'RB' | 'WR' | 'TE')[], teamName = `Team ${String(teamIndex + 1)}`) =>
  ({ teamIndex, teamName, pickLabels: ['2.01'], openStarters });
const ALL = ['QB', 'RB', 'WR', 'TE'] as const;

describe('the laptop summary of who picks before you', () => {
  it('names the next three teams compactly, then counts the rest', () => {
    const summary = describeUpcomingNeeds([team(6, ['RB', 'WR']), team(7, ['QB']), team(8, []), team(9, ['TE'])]);
    expect(summary.compact).toBe('T7 RB·WR · T8 QB · T9 set +1');
    expect(summary.spoken).toBe('Team 7 needs RB, WR. Team 8 needs QB. Team 9 has its starters. 1 more team picks before you.');
  });

  it('groups neighbours with the same needs, so the first round still names three teams', () => {
    const summary = describeUpcomingNeeds([team(5, ALL), team(6, ALL), team(7, ALL), team(8, ['QB'])]);
    expect(summary.compact).toBe('T6–8 all open +1');
    expect(summary.spoken).toContain('Team 8 has every starter spot open. 1 more team picks before you.');
  });

  it('drops to two teams rather than cut the third off partway', () => {
    const summary = describeUpcomingNeeds([team(9, ['QB', 'RB', 'WR']), team(10, ['QB', 'RB', 'TE']), team(11, ['RB', 'WR', 'TE']), team(0, ['QB'])]);
    expect(summary.compact).toBe('T10 QB·RB·WR · T11 QB·RB·TE +2');
    expect(summary.compact.length).toBeLessThanOrEqual(40);
  });

  it('shortens a provider team name and keeps it whole in the spoken text', () => {
    const summary = describeUpcomingNeeds([team(2, ['WR'], 'The Gridiron Gang'), team(3, ['QB'])]);
    expect(summary.compact).toBe('The Grid… WR · T4 QB');
    expect(summary.spoken).toContain('The Gridiron Gang needs WR');
  });

  it('says the start of a draft in one plain sentence', () => {
    const summary = describeUpcomingNeeds([team(1, ALL), team(2, ALL), team(3, ALL), team(4, ALL), team(5, ALL)]);
    expect(summary.compact).toBe('all 5 teams need every position');
    expect(summary.spoken).toBe('All 5 teams picking before you have every starter spot open.');
  });

  it('shows the needs and the context note, and neither on the final pick or with nobody in between', () => {
    const render = (nextPickLabel: string | null, teams: readonly ReturnType<typeof team>[]): string =>
      renderToStaticMarkup(createElement(AssistantRailSummary, { nextPickLabel, queueCount: 2, upcomingTeams: teams }));
    const shown = render('2.01', [team(6, ['RB'])]);
    expect(shown).toContain('Before you: </span>T7 RB');
    expect(shown).toContain('Before your pick: Team 7 needs RB.');
    expect(shown).toContain(UPCOMING_NEEDS_NOTE);
    expect(UPCOMING_NEEDS_NOTE).toMatch(/not used in the % estimates/);
    expect(shown).toContain('Queue (2) &amp; roster');
    expect(render(null, [team(6, ['RB'])])).not.toContain('data-upcoming-needs');
    expect(render(null, [team(6, ['RB'])])).toContain('No later pick');
    expect(render('2.01', [])).not.toContain('data-upcoming-note');
  });
});

describe('the next turn is stated once, in the bar at the top of the page', () => {
  it('counts to the turn itself at 1.01 from slot 1', () => {
    const window = getPickWindow(1, 12, 15, 1, 'snake');
    const count = picksUntilTurn(window);
    expect(count).toBe(23);
    // 22 other picks happen in between, but the count is to the turn itself.
    expect(window.picksBetween).toHaveLength(22);
    expect(formatNextTurn(count, '2.12')).toBe('Next turn in 23 picks (2.12)');
  });

  it('is not repeated by the laptop strip or the wide rail', () => {
    const strip = renderToStaticMarkup(createElement(AssistantRailSummary, { nextPickLabel: '2.12', queueCount: 0, upcomingTeams: [team(1, ALL)] }));
    const rail = renderToStaticMarkup(createElement(UpcomingPicks, { teams: [team(1, ALL)], nextPickLabel: '2.12', viewedPosition: null }));
    expect(strip).not.toContain('Next turn');
    expect(rail).not.toContain('Next turn');
    expect(strip).not.toContain('data-next-turn');
    expect(rail).not.toContain('data-next-turn');
  });
});

describe('the wide rail groups teams with the same needs', () => {
  it('turns a run of identical teams into one row and keeps tags for specific needs', () => {
    const groups = groupUpcomingNeeds([team(1, ALL), team(2, ALL), team(3, ['RB', 'WR']), team(4, ALL)]);
    expect(groups.map((group) => `${group.label}:${String(group.teams)}:${group.openStarters.length === 4 ? 'all' : group.openStarters.join('')}`))
      .toEqual(['Teams 2\u20133:2:all', 'Team 4:1:RBWR', 'Team 5:1:all']);
    const rail = renderToStaticMarkup(createElement(UpcomingPicks, { teams: [team(1, ALL), team(2, ALL), team(3, ['RB'])], nextPickLabel: '2.12', viewedPosition: 'RB' }));
    expect(rail).toContain('Every spot open');
    expect(rail.match(/class="position-tag"/g) ?? []).toHaveLength(1);
    expect(rail).toContain('3 of 3</strong> still need a starting RB.');
  });

  it('names a run that includes a provider team name by its first team', () => {
    expect(groupUpcomingNeeds([team(1, ALL, 'The Gridiron Gang'), team(2, ALL)])[0]?.label).toBe('The Gridiron Gang +1');
  });
});
