# Data Refresh Policy

`pnpm dev` starts local watchers and servers. It intentionally does not mutate
tracked JSON or make network-heavy refreshes. Use explicit refresh commands so a
normal coding session remains fast and reproducible.

## Commands

| Command | Purpose | When to run |
| --- | --- | --- |
| `pnpm data:check` | Reports freshness and writes `data/data-quality-report.json`. | Any time; runs before `pnpm dev`. |
| `pnpm data:check:strict` | Fails on stale or invalid required artifacts. | CI and the end of `pnpm prepare:draft`. |
| `pnpm refresh:sleeper` | Refreshes `data/sleeper-adp.json` from Sleeper player `search_rank`. | Daily during draft week. |
| `pnpm refresh:fantasypros` | Refreshes rankings, projections, and news. | Daily during draft week and shortly before drafting. |
| `pnpm data:identity` | Builds the canonical Sleeper/FantasyPros player crosswalk. | After either market source changes. |
| `pnpm refresh:contracts` | Builds current contract context from nflverse/OverTheCap history. | Weekly during the offseason and before draft prep. |
| `pnpm refresh:team-env` | Derives `data/team-environment.json` from the latest completed nflverse season. | Weekly during the offseason or after pipeline changes. |
| `pnpm refresh:daily` | Runs Sleeper, FantasyPros, identity, contract, and team-environment refreshes. | Draft week. |
| `pnpm prepare:draft` | Refreshes daily data, rebuilds DuckDB predictions and survival data, runs the backtest, and writes the prep report. | Draft week and after scoring/model changes. |
| `pnpm report:draft-prep` | Rewrites the prep report from existing artifacts. | After late keeper edits. |

## Artifact Ownership

| Artifact | Source | Notes |
| --- | --- | --- |
| `data/fantasypros-snapshot.json` | FantasyPros API or manual fallback | Current ECR, consensus PPR ADP, projections, and news. |
| `data/sleeper-adp.json` | Sleeper `/v1/players/nfl` | `search_rank` proxy only; it is not observed-draft ADP. |
| `data/player-identity.json` | Generated from FantasyPros and Sleeper | Canonical IDs, aliases, and explicit team-defense mappings. |
| `data/data-quality-report.json` | Generated validator report | Counts, joins, seasons, dependency order, warnings, and failures. |
| `data/team-environment.json` | nflverse completed-season team stats | Reproducible baseline; offseason changes remain separate signals. |
| `data/contracts.json` | nflverse historical contracts sourced from OverTheCap | Current context is populated; recommendation influence remains policy-disabled until separately backtested. |
| `data/predictions.json` | DuckDB prediction pipeline | Includes league scoring plus leakage-safe trailing snap-share and Next Gen Stats adjustments. |
| `data/recommendation-policy.json` | Roster-aware walk-forward backtest | Enables model predictions only after the ECR release gate passes. |
| `data/league-history/survival-model.json` | Imported league draft history plus Sleeper proxy | Room-specific timing adjustment, not player-quality training data. |
| `data/league-history/current-keepers.json` | Manual late draft-week input | Update when final keepers are announced, then regenerate the prep report. |
| `data/draft-prep-report.json` | Generated report | Machine-readable draft-week summary. |

## External Market Context

Underdog best-ball ADP is a useful secondary signal for broad market movement.
The current external reference is Sharp Football Analysis's
[Underdog half-PPR table](https://www.sharpfootballanalysis.com/fantasy/fantasy-football-adp-half-ppr-underdog-best-ball/).
It should remain contextual because the scoring format and best-ball
roster-construction objective differ from this keeper league.
