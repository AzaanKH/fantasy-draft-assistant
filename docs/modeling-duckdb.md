# DuckDB Modeling Workspace

DuckDB is used only for offline analytical work: local joins, source profiling,
and model dataset creation. The web app and extension consume JSON artifacts
from `data/`, but the live Decision Policy remains ECR-anchored. DuckDB model
predictions enter only the experimental Shadow Recommendation path.

## Layout

```text
data/model/
  fantasy-draft.duckdb
  raw/
  normalized/
  training-dataset.parquet
  backtests/
```

Generated DuckDB and Parquet files are ignored by git. Keep source-shaped nflverse and ffopportunity exports in `data/model/raw/`, then build normalized joins and model-ready rows from there.

## Commands

Initialize the local database from the current JSON cache:

```bash
pnpm --filter scripts model:duckdb:init
```

Profile row counts, join coverage, rookies, low-experience players, and unmatched players:

```bash
pnpm --filter scripts model:profile
```

Build the first model dataset:

```bash
pnpm --filter scripts model:dataset
```

Build only the historical as-of-draft snapshots:

```bash
pnpm model:snapshots
```

`model:dataset` also rebuilds these snapshots automatically.

## Historical draft-morning snapshots

`model.historical_asof_snapshots` and
`data/model/historical-asof-snapshots.parquet` contain one player row for each
stored Sleeper draft date. The exact Sleeper `start_time` is the cutoff, and
every contributing row must satisfy
`information_timestamp <= historical_draft_timestamp`.

Date-only sources receive a conservative information-time upper bound of the
following midnight UTC. A same-day row is therefore excluded when its actual
publication time cannot be proven. Rows with no timestamp are never treated as
old. In particular, legacy weekly roster/depth files cannot be used as
preseason snapshots merely because they later describe Week 1.

The snapshot exposes:

- Active/PUP/IR and injury designations when a timestamped pre-draft record exists;
- prior-season games played, team games, and missed games;
- as-of team, roster status, and depth position/rank;
- same-team, same-position competition from the last complete safe ranking date; and
- recent dated trades, explicitly labeled as trades-only transaction coverage.

Missing preseason coverage remains null with a field-specific reason. The
output retains the source information timestamp (or conservative upper bound)
for team, roster, injury, prior-season availability, depth, competition, and
transaction fields so every populated feature can be audited against the draft
cutoff. Transaction coverage is also marked incomplete because the available
feed does not contain signings, waivers, or cuts. The
snapshot fields enter the training dataset as `asof_*` availability/role
inputs. They do not award or remove fantasy points directly. The compact
coverage audit is written to `data/historical-snapshot-report.json`; any cutoff
violation fails the build.

Run the transparent historical recommendation replay:

```bash
pnpm model:backtest
```

Run the separate contract-year feature validation:

```bash
pnpm model:backtest:contracts
```

This uses an expanding 2012–2025 player-season history and compares identical
ridge models with and without one `is_contract_year` feature. Contracts signed
in the evaluated season are excluded because the source exposes a signing year,
not an exact signing date. The command writes
`docs/contract-year-backtest.md`, updates the ignored detailed JSON under
`data/model/backtests/`, and changes `contractSignalEnabled` only when the
multi-season release gate passes.

The training dataset combines historical production, opportunity, offensive snap share, and position-specific Next Gen Stats. Every evaluated season receives only trailing features from earlier seasons.

## Position-specific prediction layer

The offline experimental pipeline materializes `model.qb_prediction_features`,
`model.rb_prediction_features`, `model.wr_prediction_features`, and
`model.te_prediction_features`. Each table starts from a shared projected-points
prior and adds a position-specific ridge residual. Features are centered and
scaled from training rows only. Architecture, ridge penalty, and workload
threshold are selected by nested walk-forward validation, frozen, and then
refit using only seasons before the season being evaluated. Each current
position residual is recentered to zero across draftable players before the
pipeline writes it to `model.prediction_outputs` and `data/predictions.json`.
Neither output enters the live Decision Policy.

The 2026 candidate declaration is versioned as `2026-predeclared-v1`. It fixes
three architectures (`workload-only-v1`, `role-opportunity-v1`, and
`expanded-efficiency-v1`), ridge penalties, and position-specific workload
thresholds before the outer results are generated. Changing that declaration
requires a new version and means the prior outer-fold results cannot be reused
as evidence for the changed candidate set.

The outer replay is deliberately limited to these folds:

| Selection data | Inner validation | Frozen outer test |
| --- | --- | --- |
| 2021 only (predeclared cold-start fallback) | none | 2022 |
| through 2021 | 2022 | 2023 |
| through 2022 | 2023 | 2024 |
| through 2023 | 2024 | 2025 |

For each outer test season, the winning specification is refit through the
inner validation season before it is evaluated once. The test result never
changes that fold's candidate set or thresholds. For the 2026 shadow fit, the
same unchanged declaration trains candidates through 2024, selects on the 2025
prior fold, freezes the winner, and refits its coefficients through 2025.

Before centering and scaling, every observed feature is shrunk toward its
training-position average using `volume / (volume + threshold)`. Workload is
measured over the same trailing history as QB pass attempts, RB carries, WR
targets, and TE on-field dropback participation (the available route-workload
proxy). Architecture, position threshold, and ridge penalty are selected
jointly on the immediately prior validation season. Missing history and zero
workload resolve to the positional average, so they are neutral rather than
penalized. The selected specification, validation cutoff, and fitted thresholds
are persisted in `model.position_model_coefficients` and summarized in
`data/model-report.json`.

The fitted inputs now include observed participation and play-by-play signals:

- QB pressure rate, time to throw, and number of pass rushers;
- exact inside-the-five carries and targets for RB usage;
- on-field dropback participation and the charted route of the primary receiver
  for WR/TE route profiles; and
- the existing snap, target-share, air-yard, separation, YAC, and rushing-over-
  expectation features.

The nflverse participation feed charts the primary receiver's route, not every
eligible receiver's route on every dropback. `dropback_participation` is kept as
a separately named field and is not represented as an exact routes-run count.

All position models terminate at the same output boundary:

- league-scored projected points;
- floor and ceiling in league points;
- uncertainty and injury risk;
- percentile within position; and
- value over the current projected replacement player at that position.

## Live policy and shadow-model boundary

The live Decision Policy produces Best Pick from the ECR Anchor and bounded
league value, roster construction, tier, and draft-timing adjustments. Its
player records combine current FantasyPros ECR, projections, news, and ADP with
Sleeper player and market context, derived team environment, and league scoring.
The policy then adds roster state, tier supply, and next-pick survival. These
records do not contain the DuckDB prediction outputs.

The experimental path is separate. It merges `data/predictions.json` into a
shadow-only player pool, runs a Shadow Recommendation after the live decision
has committed, and logs the two results for later evaluation. The shadow result
cannot change Best Pick or Best Player, and a missing or stale prediction
artifact cannot block the Draft Workspace.

The common prediction values listed above belong to this shadow path. The
walk-forward backtest keeps them there unless the added feature family improves
the previous model out of sample and the complete model clears every ECR
release requirement. Promotion requires an explicit Decision Policy change; it
does not happen merely because `data/predictions.json` exists.

## Source Responsibilities

The modeling pipeline keeps source ownership explicit:

| Layer | Uses |
| --- | --- |
| `nflreadpy / nflverse` | Historical NFL player stats, rosters, schedules, team stats, and player IDs. |
| `nflverse participation / PBP` | Play-level pressure, charted primary-receiver routes, on-field dropback participation, and inside-the-five opportunities. Participation data from 2023 onward is FTN Data via nflverse (CC-BY-SA 4.0). |
| `ffopportunity / ffverse` | Expected fantasy points and opportunity metrics. |
| `DynastyProcess / ffverse rankings` | Historical pre-draft rankings, market-style redraft rankings, and cross-platform fantasy player IDs. |
| Experimental prediction model | nflverse production/history, ffopportunity expected points/opportunity, and DynastyProcess ranking context. Its outputs are shadow-only until promotion. |
| Live Decision Policy | Current FantasyPros ECR, projections, and news; current Sleeper market context; league settings; roster state; tier supply; and next-pick survival. It does not use experimental prediction outputs. |
| Shadow Recommendation | Experimental prediction outputs merged into a separate player pool, then scored with the current draft context and logged beside the live decision. |
| League-history survival model | Imported Sleeper draft IDs, your historical picks, and current/historical ADP/ranking context. |
| Offline draft-pick trade grader | Experimental prediction outputs, survival model features, and draft-context inputs. |

`pnpm --filter scripts model:dataset` now materializes these responsibilities into:

- `source.nflverse_*`
- `source.ffopportunity_weekly`
- `source.dynastyprocess_*`
- `model.prediction_training_dataset`
- `model.historical_draft_dates`
- `model.historical_asof_snapshots`
- `model.{qb,rb,wr,te}_prediction_features`
- `model.position_model_components`
- `model.prediction_outputs`
- `model.league_history_survival_training_dataset`
- `model.draft_pick_trade_grader_features`

It also writes `data/predictions.json` for shadow evaluation and a compact
`data/model-report.json`. The live Decision Policy does not read either artifact
as a scoring input.

Run write commands sequentially. DuckDB is embedded and protects the local `.duckdb` file with a write lock.

## Querying Locally

No server is required. Scripts open `data/model/fantasy-draft.duckdb` directly. If you have the DuckDB CLI installed, you can inspect it with:

```bash
duckdb data/model/fantasy-draft.duckdb
```

Example query:

```sql
select position, count(*) as players, avg(ecr_rank) as avg_ecr
from model.current_player_join
group by position
order by players desc;
```
