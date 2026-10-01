import { join } from 'node:path';
import { parseSession, type SessionId } from './arguments';
import { readBoundedJson, writePrivateJson } from './files';
import { CliError } from './errors';

export interface SavedConnection {
  readonly session: string;
  readonly slot?: number;
  readonly serverUrl: string;
  readonly connectedAt: string;
}
export interface ConnectionConfig {
  readonly schemaVersion: 1;
  readonly activeSession: string | null;
  readonly connections: readonly SavedConnection[];
}
export const EMPTY_CONNECTIONS: ConnectionConfig = { schemaVersion: 1, activeSession: null, connections: [] };

export async function loadConnections(root: string): Promise<ConnectionConfig> {
  try {
    const value = await readBoundedJson(join(root, '.local/cli-connections.json'), 64 * 1024) as ConnectionConfig;
    if (!value || value.schemaVersion !== 1 || !Array.isArray(value.connections) || value.connections.length > 128 ||
        !(value.activeSession === null || typeof value.activeSession === 'string') ||
        !value.connections.every(row => row && typeof row.session === 'string' &&
          parseSession(row.session).id === row.session && typeof row.serverUrl === 'string' &&
          (row.slot === undefined || Number.isInteger(row.slot) && row.slot >= 1 && row.slot <= 32) &&
          typeof row.connectedAt === 'string' && Number.isFinite(Date.parse(row.connectedAt))) ||
        value.activeSession !== null && !value.connections.some(row => row.session === value.activeSession)) {
      throw new Error('Invalid connection settings');
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY_CONNECTIONS;
    throw new CliError('INVALID_CONNECTION_CONFIG', 'The saved CLI connections are invalid. Repair or remove .local/cli-connections.json.');
  }
}

export async function saveConnection(root: string, session: SessionId, slot: number | undefined,
  serverUrl: string, now: number): Promise<string> {
  const config = await loadConnections(root);
  const connections = config.connections.filter(row => row.session !== session.id);
  const existing = config.connections.find(row => row.session === session.id);
  connections.push({ session: session.id, slot: slot ?? existing?.slot, serverUrl, connectedAt: new Date(now).toISOString() });
  const path = join(root, '.local/cli-connections.json');
  await writePrivateJson(path, { schemaVersion: 1, activeSession: session.id,
    connections: connections.slice(-128) }, true);
  return path;
}
