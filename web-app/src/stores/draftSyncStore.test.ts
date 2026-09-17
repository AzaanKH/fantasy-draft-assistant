import { afterEach, describe, expect, it } from 'vitest';
import {
  getDraftSyncConnectionFromSearch,
  getDraftSyncSearch,
  initializeDraftSyncConnection,
  parseStoredDraftSyncConnection,
  useDraftSyncConnectionStore,
} from './draftSyncStore';

describe('draft sync connection persistence', () => {
  afterEach(() => {
    useDraftSyncConnectionStore.getState().disconnect();
  });

  it('restores provider, draft ID, and position from the URL', () => {
    expect(getDraftSyncConnectionFromSearch(
      '?provider=sleeper&draftId=1393492523179057152&position=5'
    )).toEqual({
      provider: 'sleeper',
      draftId: '1393492523179057152',
      draftPosition: 5,
    });
  });

  it('keeps a valid draft connection while the slot is still unconfirmed', () => {
    expect(getDraftSyncConnectionFromSearch(
      '?provider=yahoo&leagueId=12345'
    )).toEqual({
      provider: 'yahoo',
      draftId: '12345',
      draftPosition: null,
    });
  });

  it('rejects malformed persisted state', () => {
    expect(parseStoredDraftSyncConnection('{bad-json')).toBeNull();
    expect(parseStoredDraftSyncConnection(JSON.stringify({
      provider: 'sleeper',
      draftId: 'draft-1',
      draftPosition: 0,
    }))).toBeNull();
  });

  it.each(['', ' ', '../draft', 'draft/events', 'draft?refresh', 'draft#1', '%2F', 'a'.repeat(129)])(
    'rejects malformed draft ID %j at every connection ingress', (draftId) => {
      const connection = { provider: 'sleeper' as const, draftId, draftPosition: null };
      expect(parseStoredDraftSyncConnection(JSON.stringify(connection))).toBeNull();
      expect(getDraftSyncConnectionFromSearch(
        `?provider=sleeper&draftId=${encodeURIComponent(draftId)}`
      )).toBeNull();
      useDraftSyncConnectionStore.getState().startConnection('sleeper', draftId);
      expect(useDraftSyncConnectionStore.getState().connection).toBeNull();
      useDraftSyncConnectionStore.getState().restoreConnection(connection);
      expect(useDraftSyncConnectionStore.getState().connection).toBeNull();
    }
  );

  it.each(['yahoo', 'espn'] as const)('accepts only server-supported numeric IDs for %s', (provider) => {
    expect(getDraftSyncConnectionFromSearch(`?provider=${provider}&draftId=draft-1`)).toBeNull();
    expect(getDraftSyncConnectionFromSearch(`?provider=${provider}&draftId=12345`))
      .toMatchObject({ provider, draftId: '12345' });
  });

  it('preserves valid Sleeper identifiers and normalizes manual entry', () => {
    useDraftSyncConnectionStore.getState().startConnection('sleeper', ' Draft_1-abc ');
    expect(useDraftSyncConnectionStore.getState().connection?.draftId).toBe('Draft_1-abc');
  });

  it('updates only sync parameters and preserves unrelated URL state', () => {
    expect(getDraftSyncSearch('?lens=compare&provider=yahoo&leagueId=old', {
      provider: 'sleeper',
      draftId: 'draft-1',
      draftPosition: 5,
    })).toBe('?lens=compare&provider=sleeper&draftId=draft-1&position=5');
    expect(getDraftSyncSearch(
      '?lens=compare&provider=sleeper&draftId=draft-1&position=5',
      null
    )).toBe('?lens=compare');
  });

  it('retains a persisted slot when an older URL identifies the same draft', () => {
    useDraftSyncConnectionStore.getState().restoreConnection({
      provider: 'sleeper',
      draftId: 'draft-1',
      draftPosition: 5,
    });

    initializeDraftSyncConnection('?provider=sleeper&draftId=draft-1');

    expect(useDraftSyncConnectionStore.getState().connection).toEqual({
      provider: 'sleeper',
      draftId: 'draft-1',
      draftPosition: 5,
    });
  });
});

describe('Sleeper mock practice setting', () => {
  afterEach(() => { useDraftSyncConnectionStore.getState().disconnect(); });

  it('survives reload and older links to the same draft, but never follows a different draft', () => {
    const store = useDraftSyncConnectionStore.getState();
    store.startConnection('sleeper', 'practice-1');
    store.confirmDraftPosition(5);
    store.setPrimaryLeagueSettings(true);
    const connection = useDraftSyncConnectionStore.getState().connection;
    if (!connection) throw new Error('Expected a persisted practice connection');
    expect(parseStoredDraftSyncConnection(JSON.stringify(connection))).toEqual(connection);
    expect(getDraftSyncConnectionFromSearch(getDraftSyncSearch('', connection))).toEqual(connection);
    initializeDraftSyncConnection('?provider=sleeper&draftId=practice-1&position=5');
    expect(useDraftSyncConnectionStore.getState().connection?.usePrimaryLeagueSettings).toBe(true);
    store.startConnection('sleeper', 'actual-league');
    expect(useDraftSyncConnectionStore.getState().connection?.usePrimaryLeagueSettings).toBeUndefined();
  });

  it('can be disabled without changing the draft or slot', () => {
    const store = useDraftSyncConnectionStore.getState();
    store.startConnection('sleeper', 'practice');
    store.confirmDraftPosition(5);
    store.setPrimaryLeagueSettings(true);
    store.setPrimaryLeagueSettings(false);
    expect(useDraftSyncConnectionStore.getState().connection).toEqual({ provider: 'sleeper', draftId: 'practice', draftPosition: 5 });
    expect(getDraftSyncSearch('?settings=primary-league-mock', useDraftSyncConnectionStore.getState().connection)).not.toContain('settings=');
  });

  it('rejects practice mode on another provider', () => {
    const store = useDraftSyncConnectionStore.getState();
    store.startConnection('espn', 'league');
    store.setPrimaryLeagueSettings(true);
    expect(useDraftSyncConnectionStore.getState().connection?.usePrimaryLeagueSettings).not.toBe(true);
    expect(parseStoredDraftSyncConnection(JSON.stringify({ provider: 'espn', draftId: 'league', draftPosition: 5, usePrimaryLeagueSettings: true }))).toBeNull();
  });
});
