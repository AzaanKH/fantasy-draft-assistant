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
