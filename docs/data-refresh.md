# Data Refresh Policy

`pnpm dev` starts local watchers and servers. It intentionally does not mutate
tracked JSON or make network-heavy refreshes. Use explicit refresh commands so a
normal coding session remains fast and reproducible.

## Commands

| Command | Purpose | When to run |
| --- | --- | --- |
| `pnpm data:check` | Reports stale runtime artifacts without changing files. | Any time; runs before `pnpm dev`. |
| `pnpm refresh:sleeper` | Refreshes `data/sleeper-adp.json` from Sleeper player `search_rank`. | Daily during draft week. |
| `pnpm refresh:fantasypros` | Refreshes rankings, projections, and news. | Daily during draft week and shortly before drafting. |
| `pnpm refresh:team-env` | Derives `data/team-environment.json` from the latest completed nflverse season. | Weekly during the offseason or after pipeline changes. |
| `pnpm refresh:daily` | Runs the Sleeper, FantasyPros, and team-environment refreshes. | Draft week. |
| `pnpm prepare:draft` | Refreshes daily data, rebuilds DuckDB predictions and survival data, runs the backtest, and writes the prep report. | Draft week and after scoring/model changes. |
| `pnpm report:draft-prep` | Rewrites the prep report from existing artifacts. | After late keeper edits. |

## Artifact Ownership

| Artifact | Source | Notes |
| --- | --- | --- |
| `data/fantasypros-snapshot.json` | FantasyPros API or manual fallback | Primary current expert rankings, projections, and news. |
| `data/sleeper-adp.json` | Sleeper `/v1/players/nfl` | `search_rank` proxy only; it is not observed-draft ADP. |
| `data/team-environment.json` | nflverse completed-season team stats | Reproducible baseline; offseason changes remain separate signals. |
| `data/predictions.json` | DuckDB prediction pipeline | Includes current league rush-attempt and TE-premium adjustments. |
| `data/league-history/survival-model.json` | Imported league draft history plus Sleeper proxy | Room-specific timing adjustment, not player-quality training data. |
| `data/league-history/current-keepers.json` | Manual late draft-week input | Update when final keepers are announced, then regenerate the prep report. |
| `data/draft-prep-report.json` | Generated report | Machine-readable draft-week summary. |

## External Market Context

Underdog best-ball ADP is a useful secondary signal for broad market movement.
The current external reference is Sharp Football Analysis's
[Underdog half-PPR table](https://www.sharpfootballanalysis.com/fantasy/fantasy-football-adp-half-ppr-underdog-best-ball/).
It should remain contextual because the scoring format and best-ball
roster-construction objective differ from this keeper league.
