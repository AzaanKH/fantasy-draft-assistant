/**
 * Static demo builds (`pnpm build:web:demo`) run without the local API server:
 * they serve demo-data/, start a no-keeper quick mock, and never connect to a
 * draft provider. Vite sets VITE_DEMO_MODE from BROWSER_DATA_SOURCE=demo.
 */
// tsx scripts import these modules outside Vite, where import.meta.env is undefined.
const env = (import.meta as { readonly env?: ImportMetaEnv }).env;
export const IS_DEMO = env?.VITE_DEMO_MODE === 'true';

/** The demo snapshot's source type; live readiness accepts only API or reviewed manual refreshes. */
export const DEMO_RANKINGS_SOURCE_TYPE = 'fixture';

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

export const RANKING_LABELS: RankingLabels = IS_DEMO
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

/** Names the league whose scoring drives league value. The demo has no Primary League. */
export const LEAGUE_LABEL = IS_DEMO ? 'League' : 'Primary League';
