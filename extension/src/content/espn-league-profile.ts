import {
  createLeagueSettings,
  type LeagueSettings,
  type RosterRequirements,
  type ScoringRules,
} from '@fantasy-draft/shared';

/** The active 2026 ESPN league configured for this extension build. */
export const ESPN_ACTIVE_LEAGUE_ID = '1652783544';
export const ESPN_ACTIVE_SEASON = 2026;

const ESPN_PPR_SCORING_RULES = {
  passing: {
    yardsPerPoint: 0.04,
    touchdown: 4,
    interception: -2,
    twoPointConversion: 2,
  },
  rushing: {
    yardsPerPoint: 0.1,
    touchdown: 6,
    attemptBonus: 0,
    twoPointConversion: 2,
  },
  receiving: {
    reception: 1,
    yardsPerPoint: 0.1,
    touchdown: 6,
    tePremium: 0,
    twoPointConversion: 2,
  },
  kicking: {
    fieldGoal0_39: 3,
    fieldGoal40_49: 4,
    fieldGoal50Plus: 5,
    extraPoint: 1,
    missedFieldGoal: -1,
    missedExtraPoint: 0,
  },
  defense: {
    touchdown: 6,
    sack: 1,
    interception: 2,
    fumbleRecovery: 2,
    safety: 2,
    blockedKick: 2,
    pointsAllowed: {
      shutout: 5,
      tier1_6: 4,
      tier7_13: 3,
      tier14_20: 1,
      tier21_27: 0,
      tier28_34: -1,
      tier35Plus: -3,
    },
  },
  misc: {
    fumbleLost: -2,
    fumbleRecoveryTD: 6,
  },
} as const satisfies ScoringRules;

const ESPN_ROSTER_REQUIREMENTS = {
  QB: { starters: 1, max: 4 },
  RB: { starters: 2, max: 8 },
  WR: { starters: 2, max: 8 },
  TE: { starters: 1, max: 3 },
  FLEX: { starters: 1, eligiblePositions: ['RB', 'WR', 'TE'] },
  K: { starters: 1, max: 3 },
  DEF: { starters: 1, max: 3 },
  BENCH: { spots: 8 },
} as const satisfies RosterRequirements;

const ESPN_RAW_SCORING_SETTINGS: Readonly<Record<string, number>> = {
  pass_yd: 0.04,
  pass_td: 4,
  pass_int: -2,
  pass_2pt: 2,
  rush_yd: 0.1,
  rush_td: 6,
  rush_2pt: 2,
  rec: 1,
  rec_yd: 0.1,
  rec_td: 6,
  rec_2pt: 2,
  xpm: 1,
  fgmiss: -1,
  fgm_0_39: 3,
  fgm_40_49: 4,
  fgm_50_59: 5,
  fgm_60p: 6,
  def_td: 6,
  sack: 1,
  int: 2,
  fum_rec: 2,
  safe: 2,
  blk_kick: 2,
  pts_allow_0: 5,
  pts_allow_1_6: 4,
  pts_allow_7_13: 3,
  pts_allow_14_17: 1,
  pts_allow_28_34: -1,
  pts_allow_35_45: -3,
  pts_allow_46p: -5,
  fum_lost: -2,
  fum_rec_td: 6,
};

const ESPN_UNSUPPORTED_SCORING_KEYS = [
  'fgm_60p',
  'pts_allow_14_17',
  'pts_allow_35_45',
  'pts_allow_46p',
  'yds_allow_0_99',
  'yds_allow_100_199',
  'yds_allow_200_299',
  'yds_allow_350_399',
  'yds_allow_400_449',
  'yds_allow_450_499',
  'yds_allow_500_549',
  'yds_allow_550p',
] as const;

export function getEspnLeagueSettingsProfile(
  leagueId: string,
  observedAt: number = Date.now()
): LeagueSettings | undefined {
  if (leagueId !== ESPN_ACTIVE_LEAGUE_ID) return undefined;

  return createLeagueSettings({
    source: 'espn',
    leagueId,
    totalTeams: 14,
    scoringRules: ESPN_PPR_SCORING_RULES,
    rosterRequirements: ESPN_ROSTER_REQUIREMENTS,
    rawScoringSettings: ESPN_RAW_SCORING_SETTINGS,
    unsupportedScoringKeys: ESPN_UNSUPPORTED_SCORING_KEYS,
    keepersEnabled: false,
  }, observedAt);
}
