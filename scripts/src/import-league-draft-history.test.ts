import { describe, expect, it } from 'vitest';

import { pseudonymizeUserId, sanitizeRawValue } from './import-league-draft-history.js';

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
