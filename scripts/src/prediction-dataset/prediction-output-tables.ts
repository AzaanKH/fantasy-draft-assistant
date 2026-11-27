import { KICKER_DEFENSE_POSITIONS, leagueScoringAdjustmentSql, sqlPositionList } from '@fantasy-draft/shared/league';
import { sqlString } from '../model/duckdb.js';
import type { FittedPositionResidualModel } from '../model/position-residual-model.js';
import { positionModelFamily, type FittedPositionResidualModels } from './position-residual-tables.js';
import { REPLACEMENT_RANK_SQL } from './training-tables.js';

const PROJECTED_LEAGUE_BONUS = leagueScoringAdjustmentSql({
  position: 'position',
  rushAttempts: 'projected_rush_attempts',
  receptions: 'projected_receptions',
});

function residualExpression(model: FittedPositionResidualModel): string {
  const terms = model.featureNames.map((featureName, index) => {
    const featureMean = model.featureMeans[index] ?? 0;
    const featureScale = model.featureScales[index] ?? 1;
    const coefficient = model.coefficients[index] ?? 0;
    return `(
              coalesce(greatest(trailing_player_volume_3yr, 0), 0)
                / (coalesce(greatest(trailing_player_volume_3yr, 0), 0) + ${model.volumeThreshold})
              * (coalesce(${featureName}, ${featureMean}) - ${featureMean})
              / ${featureScale}
            ) * ${coefficient}`;
  });
  const prediction = terms.length > 0 ? terms.join('\n            + ') : '0';
  return prediction;
}

/** Per-position prediction features and the final prediction outputs. */
export function predictionOutputStatements(fittedPositionModels: FittedPositionResidualModels): string[] {
  return [
    `create or replace table model.shared_prediction_features as
      select
        current_features.*,
        greatest(
          0,
          coalesce(
            projected_points,
            trailing_expected_points_per_game_3yr * 17,
            trailing_points_per_game_3yr * 17,
            greatest(0, 300 - coalesce(ecr_rank, sleeper_adp, dynastyprocess_current_ecr, 300)) * 0.72
          )
        ) as shared_base_projected_points,
        coalesce(trailing_rush_attempts_per_game_3yr, 0) * 17 as projected_rush_attempts,
        coalesce(trailing_receptions_per_game_3yr, 0) * 17 as projected_receptions,
        least(1.0, coalesce(history_seasons, 0) / 3.0) as history_reliability
      from model.current_prediction_features current_features`,
    `create or replace table model.qb_prediction_features as
      select
        clipped.* exclude (centered_residual),
        centered_residual - avg(centered_residual) filter (
          where coalesce(ecr_rank, sleeper_adp, dynastyprocess_current_ecr, 999) <= 250
        ) over () as usage_efficiency_adjustment,
        ${sqlString(positionModelFamily(fittedPositionModels.QB))}::varchar as model_family
      from (
        select
          centered.* exclude (raw_residual),
          least(${fittedPositionModels.QB.residualCap}, greatest(-${fittedPositionModels.QB.residualCap},
            raw_residual - avg(raw_residual) filter (
              where coalesce(ecr_rank, sleeper_adp, dynastyprocess_current_ecr, 999) <= 250
            ) over ()
          )) as centered_residual
        from (
          select shared.*, ${residualExpression(fittedPositionModels.QB)} as raw_residual
          from model.shared_prediction_features shared
          where position = 'QB'
        ) centered
      ) clipped`,
    `create or replace table model.rb_prediction_features as
      select
        clipped.* exclude (centered_residual),
        centered_residual - avg(centered_residual) filter (
          where coalesce(ecr_rank, sleeper_adp, dynastyprocess_current_ecr, 999) <= 250
        ) over () as usage_efficiency_adjustment,
        ${sqlString(positionModelFamily(fittedPositionModels.RB))}::varchar as model_family
      from (
        select
          centered.* exclude (raw_residual),
          least(${fittedPositionModels.RB.residualCap}, greatest(-${fittedPositionModels.RB.residualCap},
            raw_residual - avg(raw_residual) filter (
              where coalesce(ecr_rank, sleeper_adp, dynastyprocess_current_ecr, 999) <= 250
            ) over ()
          )) as centered_residual
        from (
          select shared.*, ${residualExpression(fittedPositionModels.RB)} as raw_residual
          from model.shared_prediction_features shared
          where position = 'RB'
        ) centered
      ) clipped`,
    `create or replace table model.wr_prediction_features as
      select
        clipped.* exclude (centered_residual),
        centered_residual - avg(centered_residual) filter (
          where coalesce(ecr_rank, sleeper_adp, dynastyprocess_current_ecr, 999) <= 250
        ) over () as usage_efficiency_adjustment,
        ${sqlString(positionModelFamily(fittedPositionModels.WR))}::varchar as model_family
      from (
        select
          centered.* exclude (raw_residual),
          least(${fittedPositionModels.WR.residualCap}, greatest(-${fittedPositionModels.WR.residualCap},
            raw_residual - avg(raw_residual) filter (
              where coalesce(ecr_rank, sleeper_adp, dynastyprocess_current_ecr, 999) <= 250
            ) over ()
          )) as centered_residual
        from (
          select shared.*, ${residualExpression(fittedPositionModels.WR)} as raw_residual
          from model.shared_prediction_features shared
          where position = 'WR'
        ) centered
      ) clipped`,
    `create or replace table model.te_prediction_features as
      select
        clipped.* exclude (centered_residual),
        centered_residual - avg(centered_residual) filter (
          where coalesce(ecr_rank, sleeper_adp, dynastyprocess_current_ecr, 999) <= 250
        ) over () as usage_efficiency_adjustment,
        ${sqlString(positionModelFamily(fittedPositionModels.TE))}::varchar as model_family
      from (
        select
          centered.* exclude (raw_residual),
          least(${fittedPositionModels.TE.residualCap}, greatest(-${fittedPositionModels.TE.residualCap},
            raw_residual - avg(raw_residual) filter (
              where coalesce(ecr_rank, sleeper_adp, dynastyprocess_current_ecr, 999) <= 250
            ) over ()
          )) as centered_residual
        from (
          select shared.*, ${residualExpression(fittedPositionModels.TE)} as raw_residual
          from model.shared_prediction_features shared
          where position = 'TE'
        ) centered
      ) clipped`,
    `create or replace table model.special_teams_prediction_features as
      select
        shared.*,
        0::double as usage_efficiency_adjustment,
        'special-teams-baseline-v1'::varchar as model_family
      from model.shared_prediction_features shared
      where position in ${sqlPositionList(KICKER_DEFENSE_POSITIONS)}`,
    `create or replace table model.position_model_components as
      select * from model.qb_prediction_features
      union all by name select * from model.rb_prediction_features
      union all by name select * from model.wr_prediction_features
      union all by name select * from model.te_prediction_features
      union all by name select * from model.special_teams_prediction_features`,
    `create or replace table model.prediction_outputs as
      with risk_components as (
        select
          position_features.*,
          greatest(0, shared_base_projected_points + usage_efficiency_adjustment)
            as base_ppr_projected_points,
          case
            when lower(coalesce(news_status, status, '')) = 'out' then 9
            when lower(coalesce(news_status, status, '')) = 'questionable' then 6.5
            when lower(coalesce(news_status, status, '')) = 'limited' then 5
            when lower(coalesce(news_status, status, '')) like '%injured reserve%' then 9
            when lower(coalesce(news_status, status, '')) like '%pup%' then 8
            else 2
          end as current_status_risk,
          case
            when years_experience = 0 then 2
            when history_seasons = 0 then 2
            when coalesce(trailing_max_points_per_game_3yr, 0) <
              case when position = 'QB' then 8 else 5 end
              then 2
            else 2 + least(
              4,
              trailing_weighted_availability_missed_games_3yr / (17 * 1.9) * 14
            )
          end as historical_availability_risk
        from model.position_model_components position_features
      ),
      common_outputs as (
        select
          risk_components.*,
          ${PROJECTED_LEAGUE_BONUS} as custom_scoring_adjustment,
          base_ppr_projected_points
            + ${PROJECTED_LEAGUE_BONUS} as league_projected_points,
          least(10, greatest(1,
            2.5
            + case
                when years_experience = 0 then 2.4
                when years_experience <= 2 then 1.2
                when history_seasons = 0 then 1.4
                else 0
              end
            + coalesce(trailing_points_volatility_3yr, 0) / 6
            + coalesce(dynastyprocess_current_rank_sd, 0) / 18
          )) as model_uncertainty_score,
          least(10, greatest(1,
            greatest(current_status_risk, historical_availability_risk)
          )) as model_injury_risk_score
        from risk_components
      ),
      distributions as (
        select
          common_outputs.*,
          greatest(0, league_projected_points - (
            case position when 'QB' then 18 when 'RB' then 22
              when 'WR' then 20 when 'TE' then 17 else 12 end
            + model_uncertainty_score * 2.2
          )) as floor_projected_points,
          league_projected_points + (
            case position when 'QB' then 20 when 'RB' then 25
              when 'WR' then 23 when 'TE' then 20 else 14 end
            + model_uncertainty_score * 2.6
          ) as ceiling_projected_points
        from common_outputs
      ),
      ranked as (
        select
          distributions.*,
          row_number() over (
            partition by position order by league_projected_points desc, ecr_rank asc
          ) as projected_position_rank,
          (1 - percent_rank() over (
            partition by position order by league_projected_points desc
          )) * 100 as position_percentile
        from distributions
      ),
      replacement as (
        select
          position,
          max(league_projected_points) filter (
            where projected_position_rank = ${REPLACEMENT_RANK_SQL}
          ) as replacement_points
        from ranked
        group by position
      )
      select
        sleeper_player_id,
        player_name,
        position,
        team,
        base_ppr_projected_points as base_projected_points,
        usage_efficiency_adjustment,
        custom_scoring_adjustment,
        league_projected_points as projected_points,
        floor_projected_points,
        ceiling_projected_points,
        position_percentile,
        league_projected_points - coalesce(replacement.replacement_points, 0)
          as value_over_replacement,
        least(10, greatest(1,
          5
          + coalesce(trailing_value_over_replacement_3yr, 0) / 28
          + coalesce(offense_score, 5) / 5
          + case when years_experience = 0 then 0.7 else 0 end
        )) as ceiling_score,
        least(10, greatest(1,
          5
          + coalesce(trailing_value_over_replacement_3yr, 0) / 40
          - case when coalesce(news_status, status) in ('out', 'questionable', 'limited') then 1.4 else 0 end
          - coalesce(trailing_points_volatility_3yr, 0) / 8
        )) as floor_score,
        model_uncertainty_score as uncertainty_score,
        model_injury_risk_score as injury_risk_score,
        model_family
      from ranked current_features
      left join replacement
        using (position)
      where sleeper_player_id is not null`,
  ];
}
