# Fantasy Draft Assistant Plans

This directory is the canonical place for design and implementation plans.

## Current Plan

- Canonical editable plan: `first-pass.hmtl`
- Browser copy: `first-pass.html`

The `.hmtl` file exists because the original requested filename used that extension. Browsers and static servers detect `.html` more reliably, so keep both files in sync when editing.

## Update Workflow

1. Edit `first-pass.hmtl`.
2. Copy it to `first-pass.html`.
3. Open `http://127.0.0.1:4173/first-pass.html` if the local server is running.

```bash
cp plans/first-pass.hmtl plans/first-pass.html
python3 -m http.server 4173 --bind 127.0.0.1 --directory plans
```

## Design Decisions Captured

- Runtime app data stays in JSON.
- Historical/modeling data uses Parquet plus DuckDB.
- DuckDB is local and embedded; no database server or Docker container is required.
- Rookies, low-experience players, and injured players get explicit feature handling.
- Personal league draft history is used for pick-survival and league tendency modeling, not base player quality.
- The 2022-2025 Ummati Official Sleeper draft IDs, user slots, fetched roster positions, and season-specific scoring differences are recorded in the plan.
