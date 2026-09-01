# Fantasy Draft Assistant Plans

This directory is the canonical place for design and implementation plans.

## Current reference

- [Project architecture retrospective](project-architecture-retrospective.html)
- [Interactive maintainer guide](architecture-and-data-refresh.html)

## Historical plan

The [first-pass plan](first-pass.html) is a historical record, not the current plan. Its editable source is `first-pass.hmtl`.

The `.hmtl` file exists because the original requested filename used that extension. The `.html` copy is retained for browsers and static servers.

The interactive architecture and data-refresh guide is available at:

```text
http://127.0.0.1:4173/architecture-and-data-refresh.html
```

## Design Decisions Captured

- Runtime app data stays in JSON.
- Historical/modeling data uses Parquet plus DuckDB.
- DuckDB is local and embedded; no database server or Docker container is required.
- Rookies, low-experience players, and injured players get explicit feature handling.
- Personal league draft history is used for pick-survival and league tendency modeling, not base player quality.
- The 2022-2025 Ummati Official Sleeper draft IDs, user slots, fetched roster positions, and season-specific scoring differences are recorded in the plan.
