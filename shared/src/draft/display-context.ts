export interface RankingLabels {
  /** Prefix for a single rank, as in "ECR #12". */
  readonly short: string;
  /** The same name inside a sentence. */
  readonly inline: string;
  /** Sentence-case name for headings and metric descriptions. */
  readonly title: string;
  /** Name of the player-quality baseline in metrics and policy labels. */
  readonly anchor: string;
  /** Lowercase phrase for sorting and screen-reader text. */
  readonly long: string;
  /** Where the rankings come from. */
  readonly source: string;
}

export interface DraftDisplayContext {
  readonly IS_DEMO: boolean;
  readonly RANKING_LABELS: RankingLabels;
  readonly LEAGUE_LABEL: string;
}

export function createDraftDisplayContext(isDemo: boolean): DraftDisplayContext {
  const RANKING_LABELS: RankingLabels = isDemo
    ? {
      short: 'Model rank',
      inline: 'model rank',
      title: 'Model rank',
      anchor: 'Model rank anchor',
      long: 'model rank',
      source: 'experimental model blended with Sleeper rank',
    }
    : {
      short: 'ECR',
      inline: 'ECR',
      title: 'Expert rank',
      anchor: 'ECR anchor',
      long: 'expert rank',
      source: 'FantasyPros ECR',
    };

  return { IS_DEMO: isDemo, RANKING_LABELS, LEAGUE_LABEL: isDemo ? 'League' : 'Primary League' };
}

export const LIVE_DRAFT_DISPLAY = createDraftDisplayContext(false);
