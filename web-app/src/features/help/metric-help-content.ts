import type { HelpMetric } from '@fantasy-draft/shared/draft';
import { IS_DEMO } from '@/lib/demo-mode';

export const METRIC_HELP = {
  projectedPoints: {
    title: 'Projected points',
    summary: 'Expected fantasy points for the season in your scoring format.',
    detail: 'Projected points measure total scoring. Points over a fill-in starter compare that total with a fill-in starter at the same position (the kind of player still available late), which makes positional value easier to compare.',
  },
  ecr: {
    title: 'Rankings',
    summary: IS_DEMO
      ? 'Model rank: the player-quality baseline for recommendations. Lower ranks are better.'
      : 'Expert consensus rank: the player-quality baseline for recommendations. Lower ranks are better.',
    detail: IS_DEMO
      ? 'Model rank blends an experimental projection model with Sleeper rank. Best Pick starts from this baseline and also considers your roster, league value, tiers, and draft timing.'
      : 'ECR combines expert rankings. Best Pick starts from this baseline and also considers your roster, league value, tiers, and draft timing.',
  },
  tier: {
    title: 'Position tier',
    summary: 'A group of players at the same position with similar projected value.',
    detail: 'A lower tier number represents a stronger group. The last available player in a tier matters when the next group has a meaningful drop in projected points.',
  },
  vor: {
    title: 'Pts over a fill-in starter',
    summary: 'Projected fantasy points above a fill-in starter at the same position.',
    detail: 'For example, 240 projected points minus 200 for a fill-in starter gives +40. It helps compare positional value in your league.',
  },
  returnProbability: {
    title: "Chance he's there",
    summary: 'The estimated chance this player is still available at your next selection.',
    detail: 'The estimate uses league draft history calibrated by the current draft market. A lower percentage means waiting is riskier. A higher percentage gives you more room to consider another player, but does not guarantee availability.',
  },
  waitingCost: {
    title: 'Waiting cost',
    summary: 'Expected points lost by waiting until your next selection instead of drafting this player now.',
    detail: 'Waiting cost compares this player with the Expected Next-Pick Alternative: the same-position fallback with the highest probability-weighted value at your next pick. It is part of Draft Timing and is an estimate, not a guarantee.',
  },
  bestPick: {
    title: 'Best Pick',
    summary: 'The available player recommended for improving your completed roster.',
    detail: `The decision considers ${IS_DEMO ? 'model rankings' : 'expert rankings'}, league value, roster needs, useful reserves, tier supply, and next-pick timing. Best Pick can differ from Best Player, which follows the trusted player-quality ranking without roster or timing adjustments.`,
  },
  recommendationRank: {
    title: 'Rank for this pick',
    summary: "This player's place among available players in the current decision lens.",
    detail: 'Rank #1 is the first choice in that lens. Best Pick accounts for your roster and draft timing; Best Player follows the trusted player-quality ranking. This rank can change as players are drafted.',
  },
} as const satisfies Record<HelpMetric, { readonly title: string; readonly summary: string; readonly detail: string }>;

export type { HelpMetric } from '@fantasy-draft/shared/draft';
