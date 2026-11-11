import { describe, expect, it } from 'vitest';
import { boardPlayerName, shortPlayerName } from './player-name';

describe('shortPlayerName', () => {
  it('initials the first name and keeps suffixes and initialled names', () => {
    expect(shortPlayerName('Christian McCaffrey')).toBe('C. McCaffrey');
    expect(shortPlayerName('Marvin Harrison Jr.')).toBe('M. Harrison Jr.');
    expect(shortPlayerName('A.J. Brown')).toBe('A.J. Brown');
  });

  it('names a team defense by team, never as an initialled "Defense"', () => {
    expect(shortPlayerName('BAL Defense', 'DEF', 'BAL')).toBe('BAL D/ST');
    expect(shortPlayerName('Baltimore Ravens', 'DEF', 'BAL')).toBe('BAL D/ST');
    expect(shortPlayerName('BAL Defense', 'DEF')).toBe('BAL D/ST');
  });
});

describe('boardPlayerName', () => {
  it('drops the initial only when the short name is too long for a narrow cell', () => {
    expect(boardPlayerName('Christian McCaffrey', 'RB')).toBe('C. McCaffrey');
    expect(boardPlayerName('Jaxon Smith-Njigba', 'WR')).toBe('Smith-Njigba');
  });
});
