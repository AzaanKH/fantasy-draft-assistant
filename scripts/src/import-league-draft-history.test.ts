import { describe, expect, it } from 'vitest';

import { decodeLeagueHistoryDraft, decodeLeagueHistoryPicks, decodeLeagueHistoryRosters, decodeLeagueHistoryUsers, mergeImportedSeasons, pseudonymizeUserId, resolveConfirmedManager, sanitizeRawValue } from './import-league-draft-history.js';

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

describe('confirmed prospective season manager', () => {
  const previous = { userSlot: 8, draftOrder: { manager: 8, other: 3 } };

  it('follows last season\'s slot owner through the confirmed draft order and slot-to-roster map', () => {
    expect(resolveConfirmedManager(previous, {
      draftOrder: { manager: 2, other: 8 },
      slotToRosterId: { '2': 9, '8': 4 },
    })).toEqual({ userSlot: 2, userRosterId: 9 });
  });

  it('reports, rather than guesses, when a draft lacks the mapping', () => {
    expect(resolveConfirmedManager(previous, { draftOrder: { other: 8 }, slotToRosterId: { '8': 4 } }))
      .toEqual(expect.stringContaining('not in the confirmed draft order'));
    expect(resolveConfirmedManager(previous, { draftOrder: { manager: 2 }, slotToRosterId: null }))
      .toEqual(expect.stringContaining('no roster for slot 2'));
    expect(resolveConfirmedManager({ userSlot: 5, draftOrder: previous.draftOrder }, {
      draftOrder: { manager: 2 },
      slotToRosterId: { '2': 9 },
    })).toEqual(expect.stringContaining('no single owner for slot 5'));
  });
});

describe('mergeImportedSeasons', () => {
  const season = (year: number, source: string) => ({ season: year, source });

  it('keeps an earlier prospective season and replaces only the seasons this run refreshed', () => {
    const previous = [season(2024, 'old'), season(2025, 'old'), season(2026, 'old'), season(2027, 'old')];
    const refreshed = [season(2025, 'new'), season(2024, 'new'), season(2027, 'new')];
    expect(mergeImportedSeasons(previous, refreshed)).toEqual([
      season(2024, 'new'), season(2025, 'new'), season(2026, 'old'), season(2027, 'new'),
    ]);
  });

  it('drops the latest configured season once it is removed from the configured list', () => {
    // 2025 was the newest configured draft; with it removed the run imports through 2024 and confirms 2027. The
    // stale 2025 is pre-prospective, so it is dropped; the imported 2026 is prospective and is kept.
    const previous = [season(2024, 'old'), season(2025, 'old'), season(2026, 'old')];
    const refreshed = [season(2024, 'new'), season(2027, 'new')];
    expect(mergeImportedSeasons(previous, refreshed)).toEqual([
      season(2024, 'new'), season(2026, 'old'), season(2027, 'new'),
    ]);
  });

  it('does not carry forward a configured season this run no longer imports', () => {
    expect(mergeImportedSeasons([season(2022, 'old'), season(2023, 'old')], [season(2023, 'new')]))
      .toEqual([season(2023, 'new')]);
  });
});
