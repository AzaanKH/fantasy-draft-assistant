import { describe, expect, it } from 'vitest';
import { sourceTableStatements, sqlSeasonList } from './source-tables.js';

const seasonFilters = (seasons: readonly number[]) =>
  sourceTableStatements(seasons).flatMap((statement) => statement.match(/where season .+/g) ?? []);

describe('source table season filters', () => {
  it('filters a contiguous window to exactly its seasons', () => {
    expect(seasonFilters([2021, 2022, 2023])).toEqual(Array(4).fill('where season in (2021, 2022, 2023)'));
  });

  it('skips the gap in a non-contiguous window, matching the per-season file URLs', () => {
    const statements = sourceTableStatements([2021, 2023]);
    expect(seasonFilters([2021, 2023])).toEqual(Array(4).fill('where season in (2021, 2023)'));
    expect(statements.join('\n')).not.toContain('2022');
  });

  it('rejects empty or non-integer seasons', () => {
    expect(() => sqlSeasonList([])).toThrow('At least one season');
    expect(() => sqlSeasonList([2021.5])).toThrow('integer');
    expect(() => sqlSeasonList([Number.NaN])).toThrow('integer');
  });
});
