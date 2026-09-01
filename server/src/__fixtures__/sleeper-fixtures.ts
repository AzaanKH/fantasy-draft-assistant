import type {
  SleeperDraftMetadata,
  SleeperDraftPick,
  SleeperLeague,
} from '@fantasy-draft/shared';

export const draftFixture: SleeperDraftMetadata = {
  draft_id: 'fixture-draft',
  league_id: 'fixture-league',
  status: 'drafting',
  type: 'snake',
  settings: {
    teams: 10,
    rounds: 15,
    pick_timer: 30,
  },
  draft_order: null,
};

export const leagueFixture: SleeperLeague = {
  league_id: 'fixture-league',
  total_rosters: 10,
  roster_positions: [
    'QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'K',
    'BN', 'BN', 'BN', 'BN', 'BN', 'BN',
  ],
  scoring_settings: {
    pass_yd: 0.04,
    pass_td: 4,
    pass_int: -2,
    pass_2pt: 2,
    rush_yd: 0.1,
    rush_td: 6,
    rush_att: 0.2,
    rush_2pt: 2,
    rec: 1,
    rec_yd: 0.1,
    rec_td: 6,
    rec_2pt: 2,
    bonus_rec_te: 0.5,
  },
  settings: {},
};

export const picksFixture: SleeperDraftPick[] = [
  {
    round: 1,
    roster_id: 1,
    player_id: '4034',
    picked_by: 'user-1',
    pick_no: 1,
    metadata: {
      first_name: 'Christian',
      last_name: 'McCaffrey',
      position: 'RB',
      team: 'SF',
      status: 'Active',
    },
    is_keeper: null,
    draft_slot: 1,
    draft_id: 'fixture-draft',
  },
  {
    round: 1,
    roster_id: 2,
    player_id: '7564',
    picked_by: 'user-2',
    pick_no: 2,
    metadata: {
      first_name: 'CeeDee',
      last_name: 'Lamb',
      position: 'WR',
      team: 'DAL',
      status: 'Active',
    },
    is_keeper: null,
    draft_slot: 2,
    draft_id: 'fixture-draft',
  },
  {
    round: 1,
    roster_id: 3,
    player_id: '9493',
    picked_by: 'user-3',
    pick_no: 3,
    metadata: {
      first_name: 'Sam',
      last_name: 'LaPorta',
      position: 'TE',
      team: 'DET',
      status: 'Active',
    },
    is_keeper: null,
    draft_slot: 3,
    draft_id: 'fixture-draft',
  },
];
