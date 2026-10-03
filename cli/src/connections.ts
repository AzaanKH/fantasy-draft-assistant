import { join } from 'node:path';
import { parseSession, type SessionId } from './arguments';
import { readBoundedJson, writePrivateJson } from './files';
import { CliError } from './errors';

interface SavedConnection {
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

function isSavedConnection(value: unknown): value is SavedConnection {
  if (typeof value !== 'object' || value === null) return false;
  const { session, serverUrl, slot, connectedAt } = value as Record<string, unknown>;
  return typeof session === 'string' && parseSession(session).id === session && typeof serverUrl === 'string' &&
    (slot === undefined || Number.isInteger(slot) && typeof slot === 'number' && slot >= 1 && slot <= 32) &&
    typeof connectedAt === 'string' && Number.isFinite(Date.parse(connectedAt));
}

function isConnectionConfig(value: unknown): value is ConnectionConfig {
  if (typeof value !== 'object' || value === null) return false;
  const { schemaVersion, activeSession, connections } = value as Record<string, unknown>;
  return schemaVersion === 1 && Array.isArray(connections) && connections.length <= 128 &&
    (activeSession === null || typeof activeSession === 'string') &&
    (connections as unknown[]).every(isSavedConnection) &&
    (activeSession === null || (connections as SavedConnection[]).some(row => row.session === activeSession));
}

export async function loadConnections(root: string): Promise<ConnectionConfig> {
  try {
    const value = await readBoundedJson(join(root, '.local/cli-connections.json'), 64 * 1024);
    if (!isConnectionConfig(value)) throw new Error('Invalid connection settings');
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
