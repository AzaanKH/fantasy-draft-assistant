import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { getLocalSyncToken } from './local-auth.js';

describe('local pairing capability', () => {
  it('persists a private token across service starts and rejects a symlink', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-auth-'));
    try {
      const path = join(dir, 'sync-token');
      const token = getLocalSyncToken(path);
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(getLocalSyncToken(path)).toBe(token);
      expect(statSync(path).mode & 0o777).toBe(0o600);
      const target = join(dir, 'other-file');
      writeFileSync(target, 'unchanged');
      rmSync(path);
      symlinkSync(target, path);
      expect(() => getLocalSyncToken(path)).toThrow('regular private file');
      expect(readFileSync(target, 'utf8')).toBe('unchanged');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('rejects weak configured tokens', () => {
    expect(() => getLocalSyncToken('/unused', 'replace-me')).toThrow('random base64url');
  });
});
