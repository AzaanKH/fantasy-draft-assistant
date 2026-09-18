# DuckDB modeling workspace

Use this guide when changing historical data joins, snapshot cutoffs, model
features, or backtests. For choosing sources, use [data-strategy.md](data-strategy.md);
for refresh timing and artifact ownership, use [data-refresh.md](data-refresh.md).

DuckDB performs local analytical work outside the live draft. Dataset and
snapshot builds fetch published source files over the network; local storage
does not make those builds offline-only. The web app consumes JSON artifacts,
and experimental model predictions remain in the Shadow Recommendation path.

## Layout

```text
data/model/
  fantasy-draft.duckdb
  raw/
  normalized/
  training-dataset.parquet
  backtests/
```

Generated DuckDB and Parquet files are ignored by Git. `raw/` and `normalized/`
are local working directories; the current dataset builder reads published
source URLs directly and materializes tables in DuckDB. It does not require a
manual download into `raw/`. Paths are defined in
[duckdb.ts](../scripts/src/model/duckdb.ts).

## Commands and writes

Run these from the repository root with workspace dependencies installed. Run
`pnpm --filter @fantasy-draft/shared build` first if shared code changed or its
build output is missing.

| Task | Command | Reads and writes |
| --- | --- | --- |
| Initialize current-player joins | `pnpm model:duckdb:init` | Reads existing JSON caches; writes DuckDB tables and `normalized/current-player-join.parquet`. |
| Inspect source coverage | `pnpm model:profile` | Reads initialized tables; writes `data/model/profile-report.json`. |
| Rebuild the prediction dataset | `pnpm model:dataset` | Initializes current joins, downloads historical sources, and writes training data, snapshots, predictions, and reports. |
| Rebuild historical snapshots only | `pnpm model:snapshots` | Reads stored draft dates and remote historical sources; writes snapshot tables, Parquet, and the coverage report. |
| Evaluate recommendations | `pnpm model:backtest` | Reads the built model dataset; rewrites backtest reports and recommendation policy. |
| Evaluate the contract feature | `pnpm model:backtest:contracts` | Reads historical data; rewrites contract evaluation reports and policy evidence. |

Use `pnpm model:dataset` for the complete build. Calling
`pnpm --filter scripts model:dataset` directly assumes the current-player tables
were already initialized. Dataset builds also rebuild historical snapshots.

These are data-generation commands, not local unit tests. Run the command
needed by the task and review its generated diff. Run writes sequentially
because they share one embedded DuckDB file. A lock error is a reason to find
the active writer, not to delete the database.

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

For contract validation, `pnpm model:backtest:contracts` compares identical
ridge models with and without the `is_contract_year` feature over the stored
2012-2025 history. It excludes contracts signed in the evaluated season because
the source provides a signing year rather than an exact date. The command
writes [contract-year-backtest.md](contract-year-backtest.md), detailed JSON
under `data/model/backtests/`, and validation evidence in
[recommendation-policy.json](../data/recommendation-policy.json).
`contractSignalEnabled` remains false even when validation passes.

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
Participation data from 2023 onward is FTN Data via nflverse (CC-BY-SA 4.0).

All position models terminate at the same output boundary:

- league-scored projected points;
- floor and ceiling in league points;
- uncertainty and injury risk;
- percentile within position; and
- value over the current projected replacement player at that position.

## Prediction outputs and live use

`data/predictions.json` feeds a separate Shadow Recommendation player pool when
prediction data is ready and shadow logging is enabled. Use
[data strategy](data-strategy.md#experimental-predictions-and-optional-evidence)
for the live policy and promotion rules. Neither a dataset build nor a passing
backtest enables model outputs in live recommendations.

## Materialized tables

Use [source responsibilities](data-strategy.md#current-source-responsibilities)
for source selection and ownership.
[build-prediction-dataset.ts](../scripts/src/build-prediction-dataset.ts)
loads those inputs into these DuckDB tables:

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

The `model.draft_pick_trade_grader_features` table contains experimental
prediction, survival, and draft-context inputs; it does not implement a
user-facing trade grader. The builder also writes `data/predictions.json`
and the compact `data/model-report.json` for model inspection and evaluation.

## Querying locally

No server is required. Scripts open `data/model/fantasy-draft.duckdb` directly. If you have the DuckDB CLI installed, you can inspect it with:

```bash
duckdb -readonly data/model/fantasy-draft.duckdb
```

Example query:

```sql
select position, count(*) as players, avg(ecr_rank) as avg_ecr
from model.current_player_join
group by position
order by players desc;
```
