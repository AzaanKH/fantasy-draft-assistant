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
