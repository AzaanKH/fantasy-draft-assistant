import { describe, expect, it } from 'vitest';

import { decodeLeagueHistoryDraft, decodeLeagueHistoryPicks, decodeLeagueHistoryRosters, decodeLeagueHistoryUsers, pseudonymizeUserId, sanitizeRawValue } from './import-league-draft-history.js';

describe('league draft history sanitization', () => {
  it('redacts roster nicknames and pseudonymizes user identifiers', () => {
    const sanitized = sanitizeRawValue({
      owner_id: '734368165714345984',
      metadata: {
        p_nick_4017: 'unsafe nickname',
        allow_pn: 'on',
        allow_sms: 'on',
        mention_pn: 'on',
        team_name: 'personal team name',
        avatar: 'https://example.test/avatar.jpg',
      },
      reactions: {
        '734368165714345984': ['like'],
      },
    });
    const pseudonymizedUserId = pseudonymizeUserId('734368165714345984');

    expect(sanitized).toEqual({
      owner_id: pseudonymizedUserId,
      metadata: {
        p_nick_4017: '[REDACTED]',
        allow_pn: 'off',
        allow_sms: 'off',
        mention_pn: 'off',
        team_name: '[REDACTED]',
        avatar: null,
      },
      reactions: {
        [pseudonymizedUserId]: ['like'],
      },
    });
  });
});


describe('league draft history boundaries', () => {
  const draft = { draft_id: 'draft', league_id: 'league', season: '2026', status: 'complete',
    type: 'snake', start_time: 1, settings: { teams: 10 }, metadata: null, draft_order: null };
  const pick = { round: 1, roster_id: 1, player_id: 'p1', picked_by: 'user', pick_no: 1,
    metadata: null, is_keeper: false, draft_slot: 1, draft_id: 'draft' };
  const roster = { roster_id: 1, owner_id: 'user', league_id: 'league' };
  const user = { user_id: 'user', display_name: 'Manager' };

  it.each([
    ['draft metadata', () => decodeLeagueHistoryDraft({ ...draft, metadata: { scoring_type: 42 } })],
    ['draft metadata omission', () => decodeLeagueHistoryDraft({ ...draft, metadata: undefined })],
    ['draft non-finite settings', () => decodeLeagueHistoryDraft({ ...draft, settings: { teams: Infinity } })],
    ['pick metadata', () => decodeLeagueHistoryPicks([pick, { ...pick, metadata: { first_name: 42 } }])],
    ['pick keeper flag', () => decodeLeagueHistoryPicks([pick, { ...pick, is_keeper: 'yes' }])],
    ['roster settings', () => decodeLeagueHistoryRosters([roster, { ...roster, settings: { wins: 'many' } }])],
    ['roster players', () => decodeLeagueHistoryRosters([roster, { ...roster, players: [42] }])],
    ['roster metadata', () => decodeLeagueHistoryRosters([roster, { ...roster, metadata: [] }])],
    ['user metadata', () => decodeLeagueHistoryUsers([user, { ...user, metadata: [] }])],
    ['user settings', () => decodeLeagueHistoryUsers([user, { ...user, settings: [] }])],
  ])('rejects invalid %s atomically', (_label, decode) => {
    expect(decode).toThrow();
  });

  it('preserves source metadata and complete valid arrays', () => {
    expect(decodeLeagueHistoryDraft({ ...draft, extra: true })).toEqual({ ...draft, extra: true });
    expect(decodeLeagueHistoryPicks([pick])).toEqual([pick]);
    expect(decodeLeagueHistoryRosters([{ ...roster, players: null, metadata: null }]))
      .toEqual([{ ...roster, players: null, metadata: null }]);
    expect(decodeLeagueHistoryUsers([{ ...user, metadata: null, settings: null }]))
      .toEqual([{ ...user, metadata: null, settings: null }]);
  });
});
