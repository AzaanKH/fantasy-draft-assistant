import { DEFAULT_SCORING_RULES, type Position } from '@fantasy-draft/shared';

export interface LeagueScoringAdjustmentInput {
  readonly position: Position;
  readonly rushAttempts: number;
  readonly receptions: number;
}

export interface LeagueScoringAdjustmentRules {
  readonly rushAttemptBonus: number;
  readonly teReceptionBonus: number;
}

const BASE_RULES: LeagueScoringAdjustmentRules = {
  rushAttemptBonus: 0,
  teReceptionBonus: 0,
};

export const CURRENT_LEAGUE_SCORING_ADJUSTMENTS: LeagueScoringAdjustmentRules = {
  rushAttemptBonus: DEFAULT_SCORING_RULES.rushing.attemptBonus,
  teReceptionBonus: DEFAULT_SCORING_RULES.receiving.tePremium,
};

export function getHistoricalLeagueScoringAdjustments(
  season: number
): LeagueScoringAdjustmentRules {
  if (season >= 2025) {
    return CURRENT_LEAGUE_SCORING_ADJUSTMENTS;
  }
  if (season === 2024) {
    return {
      ...BASE_RULES,
      rushAttemptBonus: CURRENT_LEAGUE_SCORING_ADJUSTMENTS.rushAttemptBonus,
    };
  }
  return BASE_RULES;
}

export function calculateLeagueScoringAdjustment(
  input: LeagueScoringAdjustmentInput,
  rules: LeagueScoringAdjustmentRules = CURRENT_LEAGUE_SCORING_ADJUSTMENTS
): number {
  const rushAttemptPoints = input.rushAttempts * rules.rushAttemptBonus;
  const teReceptionPoints = input.position === 'TE'
    ? input.receptions * rules.teReceptionBonus
    : 0;

  return rushAttemptPoints + teReceptionPoints;
}
