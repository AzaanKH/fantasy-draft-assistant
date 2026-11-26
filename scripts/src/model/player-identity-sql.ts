/**
 * One DynastyProcess identity row for each nflverse player-season. The identity table is deduplicated per
 * coalesce(sleeper_id, gsis_id, fantasypros_id) and position, so a gsis_id can keep several rows when they differ in
 * Sleeper ID or position. Joined on gsis_id alone, each extra row would duplicate the player-season and double every
 * trailing workload sum built from it.
 *
 * Rule, in order: a row with a Sleeper ID ('NA' is the source's missing value), then a row whose position matches the
 * player-season, then the lowest Sleeper ID and FantasyPros ID, so the choice never depends on scan order.
 * `player_season` carries the season the identity was resolved for; the identity's own `season` is unchanged.
 */
export function playerSeasonIdentitySql(playerSeasons: string, identities: string): string {
  return `
    select player_seasons.season as player_season, identities.*
    from ${playerSeasons} player_seasons
    join ${identities} identities on identities.gsis_id = player_seasons.gsis_id
    qualify row_number() over (
      partition by player_seasons.season, player_seasons.gsis_id
      order by
        coalesce(identities.sleeper_player_id, 'NA') = 'NA',
        identities.position is distinct from player_seasons.position,
        identities.sleeper_player_id nulls last,
        identities.fantasypros_id nulls last
    ) = 1`;
}

/**
 * At most one DynastyProcess pre-draft ranking for each nflverse player-season and position. A ranking matches on the
 * player's GSIS ID or on the Sleeper ID of the identity resolved above; two FantasyPros IDs can map to the same
 * GSIS or Sleeper ID, and each extra match would duplicate the training row and double its target.
 *
 * Rule: the best (lowest) ECR, then the lowest FantasyPros ID, so the choice never depends on scan order. 'NA' is the
 * source's missing Sleeper ID and matches nothing. The `player_*` columns key the match to its player-season.
 */
export function playerSeasonRankingSql(playerSeasons: string, identities: string, rankings: string): string {
  return `
    select
      player_seasons.season as player_season,
      player_seasons.gsis_id as player_gsis_id,
      player_seasons.position as player_position,
      rankings.*
    from ${playerSeasons} player_seasons
    left join (${playerSeasonIdentitySql(playerSeasons, identities)}) ids
      on ids.gsis_id = player_seasons.gsis_id
      and ids.player_season = player_seasons.season
    join ${rankings} rankings
      on (
        player_seasons.gsis_id = rankings.gsis_id
        or (coalesce(ids.sleeper_player_id, 'NA') <> 'NA' and ids.sleeper_player_id = rankings.sleeper_player_id)
      )
      and player_seasons.season = rankings.season
      and player_seasons.position = rankings.position
    qualify row_number() over (
      partition by player_seasons.season, player_seasons.gsis_id, player_seasons.position
      order by rankings.predraft_ecr asc nulls last, rankings.fantasypros_id nulls last
    ) = 1`;
}
