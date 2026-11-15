import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  POSITIONS,
  calculateLeagueScoringAdjustment,
  getHistoricalLeagueScoringAdjustments,
  leagueScoringAdjustmentSql,
  type Position,
} from '@fantasy-draft/shared/league';

interface CorpusRow {
  readonly position: Position;
  readonly rushAttempts: number | null;
  readonly receptions: number | null;
}

const RUSH_ATTEMPTS = [null, 0, 1, 17, 203.5, 311] as const;
const RECEPTIONS = [null, 0, 3, 47.25, 112] as const;
const CORPUS: readonly CorpusRow[] = POSITIONS.flatMap((position) =>
  RUSH_ATTEMPTS.flatMap((rushAttempts) =>
    RECEPTIONS.map((receptions) => ({ position, rushAttempts, receptions }))
  )
);
const SEASONS = [2023, 2024, 2025, 2026] as const;

function sqlNumber(value: number | null): string {
  return value === null ? 'null::double' : `${String(value)}::double`;
}

let connection: DuckDBConnection;

beforeAll(async () => {
  connection = await (await DuckDBInstance.create(':memory:')).connect();
  const values = CORPUS.map((row, index) =>
    `(${String(index)}, '${row.position}', ${sqlNumber(row.rushAttempts)}, ${sqlNumber(row.receptions)})`
  ).join(',\n');
  await connection.run(`create table corpus as select * from (values ${values}) as t(id, position, rush_attempts, receptions)`);
});

afterAll(() => {
  connection.closeSync();
});

describe('league scoring SQL twin', () => {
  it.each(SEASONS)('matches the TypeScript rule on every corpus row for %i rules', async (season) => {
    const rules = getHistoricalLeagueScoringAdjustments(season);
    const expression = leagueScoringAdjustmentSql({
      position: 'position',
      rushAttempts: 'coalesce(rush_attempts, 0)',
      receptions: 'coalesce(receptions, 0)',
    }, rules);
    const reader = await connection.runAndReadAll(`select id, (${expression})::double as bonus from corpus order by id`);
    const sql = reader.getRowObjects().map((row) => Number(row['bonus']));
    const typescript = CORPUS.map((row) => calculateLeagueScoringAdjustment({
      position: row.position,
      rushAttempts: row.rushAttempts ?? 0,
      receptions: row.receptions ?? 0,
    }, rules));

    expect(sql).toHaveLength(CORPUS.length);
    expect(sql).toEqual(typescript);
  });

});
