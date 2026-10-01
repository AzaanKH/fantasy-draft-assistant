import { describe, expect, it } from 'vitest';
import { getConnectionNotice, type ConnectionNoticeState } from './connection-notifications';
const connected: ConnectionNoticeState = { key: 'sleeper:1', provider: 'Sleeper', state: 'connected' };

describe('connection notifications', () => {
  it('stays silent on startup and repeated polling updates', () => {
    expect(getConnectionNotice(null, { ...connected, key: null, state: 'disconnected' })).toBeNull();
    expect(getConnectionNotice(null, { ...connected, state: 'syncing' })).toBeNull();
    expect(getConnectionNotice(connected, connected)).toBeNull();
  });
  it('announces connection, failure, recovery, completion, and explicit disconnection', () => {
    expect(getConnectionNotice(null, connected)).toMatchObject({ kind: 'success', message: 'Sleeper draft connected' });
    const failed = { ...connected, state: 'error' } as const;
    expect(getConnectionNotice(connected, failed)?.kind).toBe('error');
    expect(getConnectionNotice(failed, failed)).toBeNull();
    expect(getConnectionNotice(failed, connected)?.message).toBe('Sleeper connection restored');
    expect(getConnectionNotice(connected, { ...connected, state: 'complete' })?.message).toBe('Draft complete');
    expect(getConnectionNotice(connected, { ...connected, key: null, state: 'disconnected' })?.message).toBe('Sleeper disconnected');
  });
  it('does not repeat delay notices when transport alternates between stale and reconnecting', () => {
    const stale = { ...connected, state: 'stale' } as const;
    const reconnecting = { ...connected, state: 'reconnecting' } as const;
    expect(getConnectionNotice(connected, stale)?.kind).toBe('warning');
    expect(getConnectionNotice(stale, reconnecting)).toBeNull();
    expect(getConnectionNotice(reconnecting, stale)).toBeNull();
    expect(getConnectionNotice(stale, connected)?.message).toBe('Sleeper connection restored');
  });
  it('announces a newly connected draft even when the previous draft was also connected', () => {
    expect(getConnectionNotice(connected, { ...connected, key: 'sleeper:2' })?.message).toBe('Sleeper draft connected');
  });
});
