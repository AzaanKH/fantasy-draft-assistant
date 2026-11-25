# Season review

`pnpm report:season-review -- --season <year>` grades the Primary League draft
against season-to-date results. It answers how each pick returned against its
draft cost, how opponents built and managed their rosters, how reliable the
pre-draft rankings were, which risk categories paid off, and which policy
changes are worth testing. It is a retrospective; it never changes the Decision
Policy or the backtest.

## Inputs

| Input | Source | Required |
| --- | --- | --- |
| League, users, rosters, draft, picks, matchups, transactions | Sleeper public API (live) | yes |
| Weekly player stats for the season, prior-season totals | Sleeper public API (live) | yes |
| Prior-season team, games and pass attempts | nflverse `stats_player_reg_<year-1>.csv` (live) | yes |
| Pre-draft FantasyPros snapshot (rankings, ADP, projections) | `--predraft-fantasypros`, default `data/season-review/<year>/inputs/predraft-fantasypros-snapshot.json` | yes |
| League ids, keepers, rehearsal evidence, contracts, sportsbook, identity, current FantasyPros snapshot | `--data-dir` (default `data/`) | settings yes, others optional |
| Pre-draft Sleeper directory and shadow predictions | `--predraft-sleeper`, `--predraft-predictions` | optional |
| 2022–2025 pre-draft ECR for manager tendencies | `--history-ecr data/model/training-dataset.parquet` | optional |

The pre-draft files are whatever was committed or saved before the draft, for
example `git show <draft-week commit>:data/fantasypros-snapshot.json`. A
FantasyPros snapshot refreshed during the season still holds week-0 draft
rankings, so "current rank" in the report is the season-to-date league-scored
points rank, and the report says so when it detects that case.

Your draft slot comes from `isMyKeeper` in `league-history/current-keepers.json`
and `managerDraftSlot` in matching rehearsal evidence. When they disagree or are
missing the script stops; pass `--manager-slot`.

`--through-week` defaults to the last fully scored week before Sleeper's current
week. `--out` defaults to `data/season-review/<year>/`, which is gitignored and
classified private in the data catalog: raw provider responses land in `raw/`,
and the report is written as `season-review-week-<n>.json` and `.md`.

## Method

- Points are league-scored: each weekly Sleeper stat line times the league's
  `scoring_settings`. This equals Sleeper's matchup `players_points` and also
  scores players nobody rostered.
- VOR is points over positional replacement after every team fills its fixed
  starters and FLEX slots, floored at zero. Value over cost is a pick's VOR
  minus the mean VOR of the picks within seven slots of it, so it is relative to
  this room's draft rather than to a perfect-hindsight draft.
- Return vs slot is the order a position was drafted minus that player's
  season-to-date position rank. Risk categories count a pick as paying off when
  this is at least zero.
- Roster-aware ECR and Best Pick counterfactuals hold opponents' picks fixed,
  like the [recommendation backtest](recommendation-backtest.md). Best Pick is
  the current shipped rule replayed on the pre-draft board with neutral live
  inputs; the draft-day app also used live market ADP and the league survival
  model, which cannot be replayed exactly.
- Correlations are Spearman rank correlations with approximate 95% intervals.
  Team-level comparisons have n = 10 and are reported as anecdotes.

Rerun after the final regular-season week with `--through-week 18` and compare
the counterfactual totals with the 2026 backtest fold before proposing any
policy change.
