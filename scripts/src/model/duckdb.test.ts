import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { afterEach, describe, expect, it } from 'vitest';
import { connectModelDbReadOnly, runStatementsInTransaction } from './duckdb.js';

describe('connectModelDbReadOnly', () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('reads an existing database and refuses writes', async () => {
    dir = await mkdtemp(join(tmpdir(), 'model-db-'));
    const path = join(dir, 'model.duckdb');
    const writer = await (await DuckDBInstance.create(path)).connect();
    await writer.run('create table rows as select 1 as value');
    writer.closeSync();

    const connection = await connectModelDbReadOnly(path);
    try {
      const reader = await connection.runAndReadAll('select value from rows');
      expect(reader.getRowObjects()).toEqual([{ value: 1 }]);
      await expect(connection.run('create table other (value integer)')).rejects.toThrow(/read-only/i);
    } finally {
      connection.closeSync();
    }
  });

  it('creates neither the database nor its directory when it is missing', async () => {
    dir = await mkdtemp(join(tmpdir(), 'model-db-'));
    const missingDir = join(dir, 'model');
    await expect(connectModelDbReadOnly(join(missingDir, 'model.duckdb'))).rejects.toThrow();
    expect(existsSync(missingDir)).toBe(false);
  });
});

describe('runStatementsInTransaction', () => {
  it('keeps every table from the previous refresh when a later statement fails', async () => {
    const connection = await (await DuckDBInstance.create(':memory:')).connect();
    try {
      await connection.run(`create table status as select 'old' as generation`);
      await connection.run(`create table outcomes as select 'old' as generation`);
      await expect(runStatementsInTransaction(connection, [
        `create or replace table status as select 'new' as generation`,
        `create or replace table outcomes as select * from missing_source`,
      ])).rejects.toThrow(/missing_source/);
      const read = async (table: string) =>
        (await connection.runAndReadAll(`select generation from ${table}`)).getRowObjects();
      expect(await read('status')).toEqual([{ generation: 'old' }]);
      expect(await read('outcomes')).toEqual([{ generation: 'old' }]);

      await runStatementsInTransaction(connection, [
        `create or replace table status as select 'new' as generation`,
        `create or replace table outcomes as select 'new' as generation`,
      ]);
      expect(await read('status')).toEqual([{ generation: 'new' }]);
      expect(await read('outcomes')).toEqual([{ generation: 'new' }]);
    } finally {
      connection.closeSync();
    }
  });
});
