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
