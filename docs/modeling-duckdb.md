# DuckDB Modeling Workspace

DuckDB is used only for offline analytical work: local joins, source profiling, and model dataset creation. The web app and extension still consume JSON artifacts from `data/`.

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

The first dataset is a current-season feature table with placeholder historical labels. It is intentionally shaped so later nflverse/ffopportunity extracts can fill prior production, opportunity, and outcome columns without changing the app runtime contract.

## Source Responsibilities

The modeling pipeline keeps source ownership explicit:

| Layer | Uses |
| --- | --- |
| `nflreadpy / nflverse` | Historical NFL player stats, rosters, schedules, team stats, and player IDs. |
| `ffopportunity / ffverse` | Expected fantasy points and opportunity metrics. |
| `DynastyProcess / ffverse rankings` | Historical pre-draft rankings, market-style redraft rankings, and cross-platform fantasy player IDs. |
| Prediction layer | nflverse production/history, ffopportunity expected points/opportunity, and DynastyProcess ranking context. |
| Roster-aware recommendation | Prediction outputs, current FantasyPros, current Sleeper ADP, and team needs. |
| League-history survival model | Imported Sleeper draft IDs, your historical picks, and current/historical ADP/ranking context. |
| Draft-pick trade grader | Prediction layer outputs, survival model features, and roster-aware recommendation inputs. |

`pnpm --filter scripts model:dataset` now materializes these responsibilities into:

- `source.nflverse_*`
- `source.ffopportunity_weekly`
- `source.dynastyprocess_*`
- `model.prediction_training_dataset`
- `model.prediction_outputs`
- `model.league_history_survival_training_dataset`
- `model.draft_pick_trade_grader_features`

It also writes runtime `data/predictions.json` and a compact `data/model-report.json`.

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
