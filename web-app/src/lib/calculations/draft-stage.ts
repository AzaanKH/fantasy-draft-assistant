import type { Position } from '@fantasy-draft/shared';

export interface DraftStageContext {
  readonly currentPick?: number;
  readonly totalPicks?: number;
  readonly totalRounds?: number;
}

export const SPECIAL_TEAMS_LATE_DRAFT_PROGRESS = 0.72;

export function getDraftProgress(context: DraftStageContext | undefined): number {
  if (!context?.currentPick || !context.totalPicks || context.totalPicks <= 0) {
    return 0;
  }

  return Math.min(1, Math.max(0, (context.currentPick - 1) / context.totalPicks));
}

export function isSpecialTeamsPosition(position: Position): boolean {
  return position === 'K' || position === 'DEF';
}

export function shouldDeferSpecialTeams(context: DraftStageContext | undefined): boolean {
  return getDraftProgress(context) < SPECIAL_TEAMS_LATE_DRAFT_PROGRESS;
}
