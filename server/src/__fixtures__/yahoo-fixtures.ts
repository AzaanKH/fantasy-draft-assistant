export const yahooSettingsFixture = {
  service: {
    league_key: '999.l.7428778',
    league_id: 7428778,
    draft_status: 'draft',
    num_teams: 2,
    settings: {
      draft_type: 'live',
      is_auction_draft: 0,
      draft_time: 1,
      draft_pick_duration: 30,
      roster_positions: [
        { position: 'QB', position_type: 'O', count: 1 },
        { position: 'RB', position_type: 'O', count: 1 },
        { position: 'IR', position_type: 'IR', count: 1 },
      ],
    },
  },
} as const;

export const yahooPlayersFixture = {
  service: {
    player_list: [
      {
        id: 101,
        player_key: '999.p.101',
        fname: 'Alpha',
        lname: 'Quarterback',
        display_pos: 'QB',
        team_abbr: 'Buf',
      },
      {
        id: 102,
        player_key: '999.p.102',
        fname: 'Bravo',
        lname: 'Runner',
        display_pos: 'RB',
        team_abbr: 'SF',
      },
      {
        id: 103,
        player_key: '999.p.103',
        fname: 'Charlie',
        lname: 'Receiver',
        display_pos: 'WR',
        team_abbr: 'Det',
      },
    ],
  },
} as const;

export const yahooDraftResultsFixture = {
  fantasy_content: {
    league: [
      {
        league_key: '999.l.7428778',
      },
      {
        draft_results: [
          {
            0: {
              draft_result: {
                pick: '1',
                round: '1',
                team_key: '999.l.7428778.t.1',
                player_key: '999.p.101',
              },
            },
            1: {
              draft_result: {
                pick: '2',
                round: '1',
                team_key: '999.l.7428778.t.2',
              },
            },
            2: {
              draft_result: {
                pick: '3',
                round: '2',
                team_key: '999.l.7428778.t.2',
                player_key: '999.p.103',
              },
            },
          },
        ],
      },
    ],
  },
} as const;
