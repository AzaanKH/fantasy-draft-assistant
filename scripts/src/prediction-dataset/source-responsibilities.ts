import { EXCLUDES_FANTASYPROS } from '../model/duckdb.js';

const SOURCE_RESPONSIBILITIES = {
  nflverse: [
    'historical NFL player stats',
    'historical offensive snap share',
    'play-level pressure, participation, and charted primary-receiver routes',
    'play-by-play inside-the-five carries and targets',
    'historical Next Gen Stats efficiency',
    'historical rosters',
    'timestamp-gated historical injury, roster, and depth-chart snapshots',
    'prior-season missed games and dated trades as of each historical draft',
    'historical schedules',
    'historical team stats',
    'player ID mapping',
  ],
  ffopportunity: [
    'expected fantasy points',
    'expected yardage/touchdown opportunity',
    'team opportunity share metrics',
  ],
  dynastyprocess: [
    'historical pre-draft rankings',
    'market-style redraft rankings',
    'cross-platform fantasy player IDs',
  ],
  predictionLayer: [
    'uses nflverse production/history',
    'uses walk-forward fitted, centered position residuals',
    'shrinks efficiency features by position workload using training-only baselines and thresholds',
    'uses leakage-safe trailing pressure, route, goal-line, snap, and Next Gen Stats features',
    'uses ffopportunity expected points/opportunity',
    'uses DynastyProcess pre-draft ranking context',
    'uses as-of-draft availability and role context only as model inputs, never as point awards',
  ],
  rosterAwareRecommendation: [
    'uses prediction outputs',
    'uses current FantasyPros',
    'uses current Sleeper search_rank platform proxy',
    'uses team needs',
  ],
  leagueHistorySurvivalModel: [
    'uses imported Sleeper draft IDs',
    'uses historical pick outcomes',
    'uses current Sleeper platform proxy and historical ranking context',
  ],
  draftPickTradeGrader: [
    'uses prediction layer',
    'uses survival model',
    'uses roster-aware recommendation inputs',
  ],
} as const;

/** The FantasyPros-free profile drops every FantasyPros-derived input. */
const FANTASYPROS_FREE_SOURCE_RESPONSIBILITIES = {
  ...SOURCE_RESPONSIBILITIES,
  dynastyprocess: ['cross-platform fantasy player IDs'],
  predictionLayer: SOURCE_RESPONSIBILITIES.predictionLayer.filter(
    (item) => item !== 'uses DynastyProcess pre-draft ranking context'
  ),
  rosterAwareRecommendation: SOURCE_RESPONSIBILITIES.rosterAwareRecommendation.filter(
    (item) => item !== 'uses current FantasyPros'
  ),
  excludedSources: [
    'FantasyPros projections, rankings, ADP, and news',
    'DynastyProcess db_fpecr rankings (FantasyPros ECR)',
  ],
};


/** The responsibilities recorded in the prediction artifact and model report for the active source profile. */
export const MODEL_SOURCES = EXCLUDES_FANTASYPROS
  ? FANTASYPROS_FREE_SOURCE_RESPONSIBILITIES
  : SOURCE_RESPONSIBILITIES;
