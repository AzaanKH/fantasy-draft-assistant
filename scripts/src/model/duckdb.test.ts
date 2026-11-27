import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { afterEach, describe, expect, it } from 'vitest';
import { connectModelDbReadOnly } from './duckdb.js';

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
