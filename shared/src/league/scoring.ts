import type { FantasyProsProjection } from '../fantasypros.js';
import type { Position } from './positions.js';

interface PassingScoringRules {
  /** Points per passing yard (typically 0.04 = 25 yards per point) */
  readonly yardsPerPoint: number;
  readonly touchdown: number;
  /** Points per interception (negative) */
  readonly interception: number;
  readonly twoPointConversion: number;
}

interface RushingScoringRules {
  /** Points per rushing yard (typically 0.1 = 10 yards per point) */
  readonly yardsPerPoint: number;
  readonly touchdown: number;
  /** Points per rush attempt (league-specific bonus) */
  readonly attemptBonus: number;
  readonly twoPointConversion: number;
}

interface ReceivingScoringRules {
  readonly reception: number;
  /** Points per receiving yard (typically 0.1 = 10 yards per point) */
  readonly yardsPerPoint: number;
  readonly touchdown: number;
  /** Additional points per TE reception (TE premium) */
  readonly tePremium: number;
  readonly twoPointConversion: number;
}

interface KickingScoringRules {
  readonly fieldGoal0_39: number;
  readonly fieldGoal40_49: number;
  readonly fieldGoal50Plus: number;
  readonly extraPoint: number;
  /** Points for missed field goal (negative) */
  readonly missedFieldGoal: number;
  /** Points for missed extra point (negative) */
  readonly missedExtraPoint: number;
}

interface PointsAllowedTiers {
  readonly shutout: number;
  readonly tier1_6: number;
  readonly tier7_13: number;
  readonly tier14_20: number;
  readonly tier21_27: number;
  readonly tier28_34: number;
  readonly tier35Plus: number;
}

interface DefenseScoringRules {
  readonly touchdown: number;
  readonly sack: number;
  readonly interception: number;
  readonly fumbleRecovery: number;
  readonly safety: number;
  readonly blockedKick: number;
  readonly pointsAllowed: PointsAllowedTiers;
}

interface MiscScoringRules {
  /** Points per fumble lost (negative) */
  readonly fumbleLost: number;
  readonly fumbleRecoveryTD: number;
}

export interface ScoringRules {
  readonly passing: PassingScoringRules;
  readonly rushing: RushingScoringRules;
  readonly receiving: ReceivingScoringRules;
  readonly kicking: KickingScoringRules;
  readonly defense: DefenseScoringRules;
  readonly misc: MiscScoringRules;
}

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

/** League bonuses applied on top of standard PPR scoring. */
interface LeagueScoringBonusRules {
  readonly rushAttemptBonus: number;
  readonly teReceptionBonus: number;
}

interface LeagueScoringBonusInput {
  readonly position: Position;
  readonly rushAttempts: number;
  readonly receptions: number;
}

function leagueScoringBonusRules(rules: ScoringRules): LeagueScoringBonusRules {
  return {
    rushAttemptBonus: rules.rushing.attemptBonus,
    teReceptionBonus: rules.receiving.tePremium,
  };
}

// Pure so content scripts that never score can drop this module.
const CURRENT_LEAGUE_SCORING_ADJUSTMENTS: LeagueScoringBonusRules =
  /* @__PURE__ */ leagueScoringBonusRules(DEFAULT_SCORING_RULES);

const STANDARD_PPR_BONUS_RULES: LeagueScoringBonusRules = {
  rushAttemptBonus: 0,
  teReceptionBonus: 0,
};

/** Primary League bonus rules by season: the rush bonus began in 2024, the TE premium in 2025. */
export function getHistoricalLeagueScoringAdjustments(season: number): LeagueScoringBonusRules {
  if (season >= 2025) {
    return CURRENT_LEAGUE_SCORING_ADJUSTMENTS;
  }
  if (season === 2024) {
    return {
      ...STANDARD_PPR_BONUS_RULES,
      rushAttemptBonus: CURRENT_LEAGUE_SCORING_ADJUSTMENTS.rushAttemptBonus,
    };
  }
  return STANDARD_PPR_BONUS_RULES;
}

/**
 * The one league bonus rule: rush attempts earn the attempt bonus and TE receptions earn
 * the TE premium. Adds the bonus terms to `points` in that order.
 * leagueScoringAdjustmentSql is its SQL twin; a DuckDB differential test keeps them equal.
 */
function addLeagueScoringBonus(
  points: number,
  input: LeagueScoringBonusInput,
  rules: LeagueScoringBonusRules
): number {
  return points +
    input.rushAttempts * rules.rushAttemptBonus +
    (input.position === 'TE' ? input.receptions * rules.teReceptionBonus : 0);
}

export function calculateLeagueScoringAdjustment(
  input: LeagueScoringBonusInput,
  rules: LeagueScoringBonusRules = CURRENT_LEAGUE_SCORING_ADJUSTMENTS
): number {
  return addLeagueScoringBonus(0, input, rules);
}

/** SQL column expressions for leagueScoringAdjustmentSql. Callers coalesce nullable columns. */
interface LeagueScoringBonusColumns {
  readonly position: string;
  readonly rushAttempts: string;
  readonly receptions: string;
}

/**
 * DuckDB expression equal to calculateLeagueScoringAdjustment for the given columns. It is not
 * parenthesized, so callers only add it to another term.
 */
export function leagueScoringAdjustmentSql(
  columns: LeagueScoringBonusColumns,
  rules: LeagueScoringBonusRules = CURRENT_LEAGUE_SCORING_ADJUSTMENTS
): string {
  return `${columns.rushAttempts} * ${String(rules.rushAttemptBonus)}
              + case
                  when ${columns.position} = 'TE' then ${columns.receptions} * ${String(rules.teReceptionBonus)}
                  else 0
                end`;
}

/** FantasyPros PPR defaults used by the published projection total. */
const PPR_BASELINE = {
  passingYard: 0.04,
  passingTouchdown: 4,
  rushingYard: 0.1,
  rushingTouchdown: 6,
  reception: 1,
  receivingYard: 0.1,
  receivingTouchdown: 6,
} as const;

interface LeagueProjectionResult {
  readonly projectedPoints: number;
  readonly adjustment: number;
}

function contribution(
  stat: number | undefined,
  leagueRate: number,
  baselineRate: number
): number {
  return stat === undefined ? 0 : stat * (leagueRate - baselineRate);
}

/**
 * Re-scores a FantasyPros full-PPR projection from its stat components. The
 * PPR total stays the source baseline; only rule deltas supported by the
 * projection components are added or removed locally.
 */
export function calculateLeagueProjection(
  projection: FantasyProsProjection,
  position: Position,
  rules: ScoringRules
): LeagueProjectionResult {
  const basePoints = projection.baseProjectedPoints ?? projection.projectedPoints;
  const receptions = projection.projectedReceptions;
  const rateAdjustment =
    contribution(
      projection.projectedPassingYards,
      rules.passing.yardsPerPoint,
      PPR_BASELINE.passingYard
    ) +
    contribution(
      projection.projectedPassingTouchdowns,
      rules.passing.touchdown,
      PPR_BASELINE.passingTouchdown
    ) +
    contribution(
      projection.projectedRushingYards,
      rules.rushing.yardsPerPoint,
      PPR_BASELINE.rushingYard
    ) +
    contribution(
      projection.projectedRushingTouchdowns,
      rules.rushing.touchdown,
      PPR_BASELINE.rushingTouchdown
    ) +
    contribution(
      receptions,
      rules.receiving.reception,
      PPR_BASELINE.reception
    ) +
    contribution(
      projection.projectedReceivingYards,
      rules.receiving.yardsPerPoint,
      PPR_BASELINE.receivingYard
    ) +
    contribution(
      projection.projectedReceivingTouchdowns,
      rules.receiving.touchdown,
      PPR_BASELINE.receivingTouchdown
    );
  const adjustment = addLeagueScoringBonus(rateAdjustment, {
    position,
    rushAttempts: projection.projectedRushAttempts ?? 0,
    receptions: receptions ?? 0,
  }, leagueScoringBonusRules(rules));

  return {
    projectedPoints: Number((basePoints + adjustment).toFixed(2)),
    adjustment: Number(adjustment.toFixed(2)),
  };
}
