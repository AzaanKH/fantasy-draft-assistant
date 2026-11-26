import { DuckDBInstance } from '@duckdb/node-api';
import { describe, expect, it } from 'vitest';
import { playerSeasonIdentitySql, playerSeasonRankingSql } from './player-identity-sql.js';

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

  it('joins identity and rankings without duplicating a player-season or doubling its target', async () => {
    const connection = await (await DuckDBInstance.create(':memory:')).connect();
    try {
      await connection.run(`create table player_seasons as select * from (values
        (2025, 'g-1', 'WR', 200.0), (2025, 'g-2', 'RB', 150.0), (2025, 'g-3', 'TE', 90.0), (2025, 'g-4', 'QB', 80.0)
      ) as t(season, gsis_id, position, actual_points)`);
      await connection.run(`create table identities as select * from (values
        (2026, 'g-1', 's-1', 'fp-1', 'WR'),
        (2026, 'g-2', 's-2', 'fp-3', 'RB'),
        (2026, 'g-3', 'NA', 'fp-5', 'TE'),
        (2026, 'g-4', 'NA', 'fp-7', 'QB')
      ) as t(season, gsis_id, sleeper_player_id, fantasypros_id, position)`);
      // g-1: two FantasyPros IDs carry his GSIS ID. g-2: one ranking by GSIS ID, another by his Sleeper ID. g-3 and
      // g-4: no Sleeper ID ('NA'), so a stray 'NA' Sleeper ranking must not match them; g-3 has his own ranking.
      await connection.run(`create table rankings as select * from (values
        (2025, 'fp-2', 'g-1', 's-1', 'WR', 14.0::double),
        (2025, 'fp-1', 'g-1', 's-1', 'WR', 9.0),
        (2025, 'fp-3', 'g-2', 's-2', 'RB', 20.0),
        (2025, 'fp-4', null, 's-2', 'RB', 20.0),
        (2025, 'fp-5', 'g-3', 'NA', 'TE', 30.0),
        (2025, 'fp-6', null, 'NA', 'TE', 5.0),
        (2025, 'fp-8', null, 'NA', 'QB', 2.0)
      ) as t(season, fantasypros_id, gsis_id, sleeper_player_id, position, predraft_ecr)`);
      const rows = (await connection.runAndReadAll(`
        select ps.season, ps.gsis_id, ids.sleeper_player_id, rankings.fantasypros_id, rankings.predraft_ecr,
          sum(ps.actual_points) over (partition by ps.season, ps.gsis_id)::double as target_total
        from player_seasons ps
        left join (${playerSeasonIdentitySql('player_seasons', 'identities')}) ids
          on ps.gsis_id = ids.gsis_id and ps.season = ids.player_season
        left join (${playerSeasonRankingSql('player_seasons', 'identities', 'rankings')}) rankings
          on ps.season = rankings.player_season
          and ps.gsis_id = rankings.player_gsis_id
          and ps.position = rankings.player_position
        order by ps.gsis_id
      `)).getRowObjects();
      expect(rows).toEqual([
        // The best ECR wins; one row, so the target is not doubled.
        { season: 2025, gsis_id: 'g-1', sleeper_player_id: 's-1', fantasypros_id: 'fp-1', predraft_ecr: 9, target_total: 200 },
        // Tied ECR: the lowest FantasyPros ID.
        { season: 2025, gsis_id: 'g-2', sleeper_player_id: 's-2', fantasypros_id: 'fp-3', predraft_ecr: 20, target_total: 150 },
        { season: 2025, gsis_id: 'g-3', sleeper_player_id: 'NA', fantasypros_id: 'fp-5', predraft_ecr: 30, target_total: 90 },
        { season: 2025, gsis_id: 'g-4', sleeper_player_id: 'NA', fantasypros_id: null, predraft_ecr: null, target_total: 80 },
      ]);
    } finally {
      connection.closeSync();
    }
  });

  async function rankingsFor(rankings: string): Promise<Record<string, unknown>[]> {
    const connection = await (await DuckDBInstance.create(':memory:')).connect();
    try {
      await connection.run(`create table player_seasons as select * from (values
        (2025, 'g-1', 'WR')
      ) as t(season, gsis_id, position)`);
      await connection.run(`create table identities as select * from (values
        (2026, 'g-1', 's-1', 'fp-1', 'WR')
      ) as t(season, gsis_id, sleeper_player_id, fantasypros_id, position)`);
      await connection.run(`create table rankings as select * from (values ${rankings}
      ) as t(season, fantasypros_id, gsis_id, sleeper_player_id, position, predraft_ecr)`);
      return (await connection.runAndReadAll(`
        select player_gsis_id, fantasypros_id, sleeper_player_id, predraft_ecr
        from (${playerSeasonRankingSql('player_seasons', 'identities', 'rankings')})
      `)).getRowObjects();
    } finally {
      connection.closeSync();
    }
  }

  it('keeps the best ECR among aliases of one player', async () => {
    // Same Sleeper ID, a missing one ('NA') and none at all: all the same player, so the best ECR wins.
    expect(await rankingsFor(`
      (2025, 'fp-1', 'g-1', 's-1', 'WR', 14.0::double),
      (2025, 'fp-2', 'g-1', 'NA', 'WR', 9.0),
      (2025, 'fp-3', 'g-1', null, 'WR', 11.0),
      (2025, 'fp-4', null, 's-1', 'WR', 12.0)
    `)).toEqual([{ player_gsis_id: 'g-1', fantasypros_id: 'fp-2', sleeper_player_id: 'NA', predraft_ecr: 9 }]);
  });

  it('fails naming both identities when rankings sharing a GSIS ID carry different Sleeper IDs', async () => {
    // fp-2 has the better ECR but belongs to a different player; attaching it to g-1 would be silent corruption.
    await expect(rankingsFor(`
      (2025, 'fp-1', 'g-1', 's-1', 'WR', 14.0::double),
      (2025, 'fp-2', 'g-1', 's-2', 'WR', 9.0)
    `)).rejects.toThrow(
      'Conflicting DynastyProcess rankings for GSIS ID g-1 in 2025 (WR): Sleeper IDs s-1 (FantasyPros fp-1) and s-2 ' +
      '(FantasyPros fp-2) are different players'
    );
  });
});
