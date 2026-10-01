export const METRIC_HELP = {
  projectedPoints: {
    title: 'Projected points',
    summary: 'Expected fantasy points for the season in your scoring format.',
    detail: 'Projected points measure total scoring. Above replacement compares that total with a replacement-level player at the same position, which makes positional value easier to compare.',
  },
  ecr: {
    title: 'ECR anchor',
    summary: 'Expert consensus rank: the player-quality baseline for recommendations. Lower ranks are better.',
    detail: 'ECR combines expert rankings. Best Pick starts from this baseline and also considers your roster, league value, tiers, and draft timing.',
  },
  tier: {
    title: 'Position tier',
    summary: 'A group of players at the same position with similar projected value.',
    detail: 'A lower tier number represents a stronger group. The last available player in a tier matters when the next group has a meaningful drop in projected points.',
  },
  vor: {
    title: 'Above replacement',
    summary: 'Projected fantasy points above a replacement-level player at the same position.',
    detail: 'This is value over replacement, or VOR. For example, 240 projected points minus a 200-point replacement baseline gives +40 VOR. It helps compare positional value in your league.',
  },
  returnProbability: {
    title: 'Return Probability',
    summary: 'The estimated chance this player is still available at your next selection.',
    detail: 'The estimate uses league draft history calibrated by the current draft market. A lower percentage means waiting is riskier. A higher percentage gives you more room to consider another player, but does not guarantee availability.',
  },
  bestPick: {
    title: 'Best Pick',
    summary: 'The available player recommended for improving your completed roster.',
    detail: 'The decision considers expert rankings, league value, roster needs, useful reserves, tier supply, and next-pick timing. Best Pick can differ from Best Player, which follows the trusted player-quality ranking without roster or timing adjustments.',
  },
  recommendationRank: {
    title: 'Recommendation rank',
    summary: "This player's place among available players in the current decision lens.",
    detail: 'Rank #1 is the first choice in that lens. Best Pick accounts for your roster and draft timing; Best Player follows the trusted player-quality ranking. This rank can change as players are drafted.',
  },
} as const;

export type HelpMetric = keyof typeof METRIC_HELP;
