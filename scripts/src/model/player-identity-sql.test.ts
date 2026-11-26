import { DuckDBInstance } from '@duckdb/node-api';
import { describe, expect, it } from 'vitest';
import { playerSeasonIdentitySql } from './player-identity-sql.js';

describe('playerSeasonIdentitySql', () => {
  it('resolves each player-season to exactly one identity row by a fixed rule', async () => {
    const connection = await (await DuckDBInstance.create(':memory:')).connect();
    try {
      await connection.run(`create table player_seasons as select * from (values
        (2024, 'g-1', 'WR'), (2025, 'g-1', 'TE'), (2025, 'g-2', 'RB'), (2025, 'g-3', 'QB')
      ) as t(season, gsis_id, position)`);
      // g-1 has two rows with Sleeper IDs at different positions and one without; g-2 only the source's 'NA'
      // Sleeper ID and a real one; g-3 two Sleeper-less rows.
      await connection.run(`create table identities as select * from (values
        (2026, 'g-1', null, 'fp-0', 'WR'),
        (2026, 'g-1', 's-9', 'fp-1', 'WR'),
        (2026, 'g-1', 's-5', 'fp-2', 'TE'),
        (2026, 'g-2', 'NA', 'fp-3', 'RB'),
        (2026, 'g-2', 's-7', 'fp-4', 'WR'),
        (2026, 'g-3', null, 'fp-6', 'QB'),
        (2026, 'g-3', null, 'fp-5', 'QB')
      ) as t(season, gsis_id, sleeper_player_id, fantasypros_id, position)`);
      const rows = (await connection.runAndReadAll(`
        select player_season, gsis_id, sleeper_player_id, fantasypros_id
        from (${playerSeasonIdentitySql('player_seasons', 'identities')})
        order by player_season, gsis_id
      `)).getRowObjects();
      expect(rows).toEqual([
        // A Sleeper ID first, then the player-season's position.
        { player_season: 2024, gsis_id: 'g-1', sleeper_player_id: 's-9', fantasypros_id: 'fp-1' },
        { player_season: 2025, gsis_id: 'g-1', sleeper_player_id: 's-5', fantasypros_id: 'fp-2' },
        // 'NA' is not a Sleeper ID, so the real one wins despite the position mismatch.
        { player_season: 2025, gsis_id: 'g-2', sleeper_player_id: 's-7', fantasypros_id: 'fp-4' },
        // Otherwise the lowest ID.
        { player_season: 2025, gsis_id: 'g-3', sleeper_player_id: null, fantasypros_id: 'fp-5' },
      ]);
    } finally {
      connection.closeSync();
    }
  });
});
