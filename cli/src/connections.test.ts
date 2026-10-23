import { afterEach, describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EMPTY_CONNECTIONS, loadConnections } from './connections';

const roots: string[] = [];
async function fixture(value?: unknown) {
  const root = await mkdtemp(join(tmpdir(), 'draft-connections-'));
  roots.push(root);
  if (value !== undefined) {
    await mkdir(join(root, '.local'));
    await writeFile(join(root, '.local/cli-connections.json'), JSON.stringify(value));
  }
  return root;
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const row = { session: 'sleeper:draft-1', slot: 2, serverUrl: 'http://localhost:3001', connectedAt: '2026-10-19T12:00:00Z' };
const config = { schemaVersion: 1, activeSession: row.session, connections: [row] };

describe('CLI connection storage boundary', () => {
  it('keeps the empty fallback for a missing file', async () => {
    expect(await Effect.runPromise(loadConnections(await fixture()))).toEqual(EMPTY_CONNECTIONS);
  });
  it('preserves valid connections and excess stored fields', async () => {
    const value = { ...config, extra: true, connections: [{ ...row, label: 'draft' }] };
    expect(await Effect.runPromise(loadConnections(await fixture(value)))).toEqual(value);
  });
  it.each([
    { connections: [{ ...row, slot: 0 }] },
    { connections: [{ ...row, session: 'unknown:invalid' }] },
    { connections: [{ ...row, connectedAt: 'not-a-date' }] },
    { connections: [{ ...row, serverUrl: null }] },
    { connections: [...config.connections, null] },
    { activeSession: 'sleeper:missing' },
    { connections: Array.from({ length: 129 }, () => row) },
  ])('rejects an invalid connection file atomically: %j', async invalid => {
    await expect(Effect.runPromise(loadConnections(await fixture({ ...config, ...invalid }))))
      .rejects.toMatchObject({ code: 'INVALID_CONNECTION_CONFIG' });
  });
});
