import { beforeEach, describe, expect, it } from 'vitest';
import {
  extractPicksFromDocument,
  getPickKey,
  parsePickFromText,
} from './pick-parser';

describe('Sleeper pick parsing', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('parses a structured pick announcement', () => {
    expect(parsePickFromText('Patrick Mahomes 1.1 QB - KC', 42)).toEqual({
      playerName: 'Patrick Mahomes',
      teamName: 'KC',
      pickNumber: '1.1',
      position: 'QB',
      timestamp: 42,
    });
  });

  it('extracts both pick rows and drafted announcements from the DOM', () => {
    document.body.innerHTML = `
      <div class="player-row">Justin Jefferson 2.3 WR - MIN</div>
      <div class="drafted-message">Team Alpha drafted Breece Hall</div>
    `;

    expect(extractPicksFromDocument(document, 99)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          playerName: 'Justin Jefferson',
          pickNumber: '2.3',
        }),
        expect.objectContaining({
          playerName: 'Breece Hall',
          teamName: 'Team Alpha',
        }),
      ])
    );
  });

  it('builds a stable deduplication key', () => {
    const pick = parsePickFromText('Amon-Ra St. Brown 3.2 WR - DET', 1);
    expect(pick && getPickKey(pick)).toBe('Amon-Ra St. Brown-3.2-WR');
  });

  it('does not combine drafted announcements from a matching container', () => {
    document.body.innerHTML = `
      <div class="pick-list">
        <div class="drafted-message">Team Alpha drafted Breece Hall</div>
        <div class="drafted-message">Team Beta drafted CeeDee Lamb</div>
      </div>
    `;

    const picks = extractPicksFromDocument(document, 99);

    expect(picks).toEqual([
      { playerName: 'Breece Hall', teamName: 'Team Alpha', timestamp: 99 },
      { playerName: 'CeeDee Lamb', teamName: 'Team Beta', timestamp: 99 },
    ]);
  });
});
