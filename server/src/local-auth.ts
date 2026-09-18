import { randomBytes } from 'node:crypto';
import {
  chmodSync, linkSync, lstatSync, mkdirSync, readFileSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LOCAL_SYNC_TOKEN_PATH = fileURLToPath(new URL('../../.local/sync-token', import.meta.url));

/** Shared by the Node server and Vite configuration, never imported by browser code. */
export function getLocalSyncToken(
  tokenPath: string = LOCAL_SYNC_TOKEN_PATH,
  configuredToken: string | undefined = process.env.SYNC_REQUEST_TOKEN
): string {
  if (configuredToken !== undefined) {
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(configuredToken)) {
      throw new Error('SYNC_REQUEST_TOKEN must be a random base64url token of 43–128 characters');
    }
    return configuredToken;
  }

  mkdirSync(dirname(tokenPath), { recursive: true, mode: 0o700 });
  // Atomically publish a fully written token when Vite and the server start together.
  const temporaryPath = join(dirname(tokenPath), `.sync-token-${randomBytes(12).toString('hex')}`);
  writeFileSync(temporaryPath, randomBytes(32).toString('base64url'), { flag: 'wx', mode: 0o600 });
  try {
    try {
      linkSync(temporaryPath, tokenPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  } finally {
    unlinkSync(temporaryPath);
  }
  const metadata = lstatSync(tokenPath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('Local sync token must be a regular private file');
  }
  chmodSync(tokenPath, 0o600);
  const token = readFileSync(tokenPath, 'utf8').trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new Error('Invalid local sync token; remove .local/sync-token and restart both services to pair again');
  }
  return token;
}
