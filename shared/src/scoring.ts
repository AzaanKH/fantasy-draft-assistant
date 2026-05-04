/**
 * Passing scoring rules
 */
export interface PassingScoringRules {
  /** Points per passing yard (typically 0.04 = 25 yards per point) */
  readonly yardsPerPoint: number;
  /** Points per passing touchdown */
  readonly touchdown: number;
  /** Points per interception (negative) */
  readonly interception: number;
  /** Points per 2-point conversion */
  readonly twoPointConversion: number;
}

/**
 * Rushing scoring rules
 */
export interface RushingScoringRules {
  /** Points per rushing yard (typically 0.1 = 10 yards per point) */
  readonly yardsPerPoint: number;
  /** Points per rushing touchdown */
  readonly touchdown: number;
  /** Points per rush attempt (league-specific bonus) */
  readonly attemptBonus: number;
  /** Points per 2-point conversion */
  readonly twoPointConversion: number;
}

/**
 * Receiving scoring rules
 */
export interface ReceivingScoringRules {
  /** Points per reception (PPR) */
  readonly reception: number;
  /** Points per receiving yard (typically 0.1 = 10 yards per point) */
  readonly yardsPerPoint: number;
  /** Points per receiving touchdown */
  readonly touchdown: number;
  /** Additional points per TE reception (TE premium) */
  readonly tePremium: number;
  /** Points per 2-point conversion */
  readonly twoPointConversion: number;
}

/**
 * Kicking scoring rules
 */
export interface KickingScoringRules {
  /** Points for field goal 0-39 yards */
  readonly fieldGoal0_39: number;
  /** Points for field goal 40-49 yards */
  readonly fieldGoal40_49: number;
  /** Points for field goal 50+ yards */
  readonly fieldGoal50Plus: number;
  /** Points per extra point made */
  readonly extraPoint: number;
  /** Points for missed field goal (negative) */
  readonly missedFieldGoal: number;
  /** Points for missed extra point (negative) */
  readonly missedExtraPoint: number;
}

/**
 * Points allowed tiers for defense scoring
 */
export interface PointsAllowedTiers {
  /** Shutout (0 points allowed) */
  readonly shutout: number;
  /** 1-6 points allowed */
  readonly tier1_6: number;
  /** 7-13 points allowed */
  readonly tier7_13: number;
  /** 14-20 points allowed */
  readonly tier14_20: number;
  /** 21-27 points allowed */
  readonly tier21_27: number;
  /** 28-34 points allowed */
  readonly tier28_34: number;
  /** 35+ points allowed */
  readonly tier35Plus: number;
}

/**
 * Defense/Special Teams scoring rules
 */
export interface DefenseScoringRules {
  /** Points per defensive touchdown */
  readonly touchdown: number;
  /** Points per sack */
  readonly sack: number;
  /** Points per interception */
  readonly interception: number;
  /** Points per fumble recovery */
  readonly fumbleRecovery: number;
  /** Points per safety */
  readonly safety: number;
  /** Points per blocked kick */
  readonly blockedKick: number;
  /** Points based on points allowed */
  readonly pointsAllowed: PointsAllowedTiers;
}

/**
 * Miscellaneous scoring rules
 */
export interface MiscScoringRules {
  /** Points per fumble lost (negative) */
  readonly fumbleLost: number;
  /** Points per fumble recovery touchdown */
  readonly fumbleRecoveryTD: number;
}

/**
 * Complete scoring rules configuration
 */
export interface ScoringRules {
  readonly passing: PassingScoringRules;
  readonly rushing: RushingScoringRules;
  readonly receiving: ReceivingScoringRules;
  readonly kicking: KickingScoringRules;
  readonly defense: DefenseScoringRules;
  readonly misc: MiscScoringRules;
}

/**
 * Default scoring rules for 10-team keeper league
 * Full PPR + TE Premium (+0.5) + Rush Attempt Bonus (+0.20)
 */
export const DEFAULT_SCORING_RULES: ScoringRules = {
  passing: {
    yardsPerPoint: 0.04,
    touchdown: 4,
    interception: -2,
    twoPointConversion: 2,
  },
  rushing: {
    yardsPerPoint: 0.1,
    touchdown: 6,
    attemptBonus: 0.2,
    twoPointConversion: 2,
  },
  receiving: {
    reception: 1,
    yardsPerPoint: 0.1,
    touchdown: 6,
    tePremium: 0.5,
    twoPointConversion: 2,
  },
  kicking: {
    fieldGoal0_39: 3,
    fieldGoal40_49: 4,
    fieldGoal50Plus: 5,
    extraPoint: 1,
    missedFieldGoal: -1,
    missedExtraPoint: -1,
  },
  defense: {
    touchdown: 6,
    sack: 1,
    interception: 2,
    fumbleRecovery: 2,
    safety: 2,
    blockedKick: 2,
    pointsAllowed: {
      shutout: 10,
      tier1_6: 7,
      tier7_13: 4,
      tier14_20: 1,
      tier21_27: 0,
      tier28_34: -1,
      tier35Plus: -4,
    },
  },
  misc: {
    fumbleLost: -2,
    fumbleRecoveryTD: 6,
  },
} as const;
