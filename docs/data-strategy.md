# Data Strategy

Last updated: May 12, 2026

This document is the current source of truth for:

- which data sources the project should use
- which sources should not be primary dependencies
- how team environment should be generated
- how prediction and recommendation should be separated
- the recommended implementation order

## Summary

The project should use a multi-source model with clear responsibilities:

- `Sleeper`: live draft state and platform market context
- `FantasyPros`: current expert rankings, current projections, current news
- `nflreadpy` / `nflverse`: historical model-training data, team environment inputs, player/team ID mapping, depth charts, schedules, rosters, team stats
- `ffopportunity` / ffverse data via nflverse tooling: expected fantasy points and opportunity signals

The project should not use FantasyPros as the historical modeling foundation, and it should not depend on Fantasy Football Data Pros as a primary current-season source.

## Source Decisions

### Sleeper

Use Sleeper as the source of truth for:

- live draft state
- draft picks
- current platform market rank / ADP proxy
- player IDs used during the draft

Why:

- it is the platform the app is assisting
- sync latency matters more than model richness here
- it gives the current market view that users are actually drafting against

### FantasyPros

Use FantasyPros for:

- current consensus rankings
- current expert projections
- current news / injury items

Do not use FantasyPros as the historical model-training base.

Why:

- it is the best current expert signal available to this project
- it directly powers the expert-vs-market comparison users care about
- its current API terms are personal, non-commercial, and explicitly restrict some historical/statistical uses

Practical implication:

- the project should ingest FantasyPros into a cached local snapshot
- the app should not depend on repeated live requests during the draft
- the recommendation engine should treat FantasyPros as one current-season signal family, not the whole system

### nflreadpy / nflverse

Use nflreadpy / nflverse for:

- historical player stats
- historical team stats
- schedules
- rosters
- depth charts
- player ID mapping across fantasy platforms
- model features for team environment and prediction

Why:

- it is the cleanest open historical data foundation available to this project
- it has strong coverage for stats and team context
- it is better suited to feature engineering and backtesting than expert APIs
- the data is open and easier to reason about operationally than proprietary scraping workflows

Caveat:

- current injury coverage is incomplete there; nflverse notes that the injury source died after the 2024 season, with no 2025 injury data currently available

So:

- use nflverse for structure and historical features
- do not rely on it as the primary current injury/news feed

### ffopportunity / ffverse data

Use ffopportunity-style data for:

- expected fantasy points
- opportunity-based player signals
- player usage context beyond raw fantasy scoring

Why:

- expected fantasy points are better model inputs than raw fantasy points alone
- opportunity metrics help separate talent/usage from noisy scoring variance
- these features are useful for both recommendation scoring and later prediction work

### Fantasy Football Data Pros

Do not use Fantasy Football Data Pros as a primary current-season source.

Why:

- their public API documentation still advertises a minimal API and references projections for 2020
- local probing on May 12, 2026 showed `/api/projections` returning stale-looking data and season endpoints not behaving like current JSON APIs
- that makes it unsuitable as a core live-source dependency

Possible use:

- optional benchmark
- optional fallback for historical fantasy totals if needed

But not:

- primary projection source
- primary current rankings source
- primary team environment source

## Team Environment V2

The current `team-environment.json` is too manual and should be replaced with derived data.

Current problem:

- [`scripts/src/generate-team-env.ts`](../scripts/src/generate-team-env.ts) is effectively a hand-maintained ranking table
- this will drift and is hard to defend analytically

Target design:

- generate `data/team-environment.json` from derived metrics instead of manual assignments

Recommended inputs:

- points scored
- pass attempts
- rush attempts
- passing EPA
- rushing EPA
- pass rate / pass tendency
- plays per game / pace
- red-zone volume
- coaching continuity
- roster or depth-chart stability

Primary source for those inputs:

- `nflreadpy` / `nflverse`

What team environment should become:

- a reproducible feature pipeline
- a stable intermediate dataset
- one input into player scoring, not a subjective manual label table

## Prediction vs Recommendation

The project should separate prediction from recommendation.

### Prediction Layer

The prediction layer answers:

- how good is this player likely to be?

Outputs should include examples like:

- projected points
- ceiling
- floor
- uncertainty
- opportunity-adjusted value

Inputs should come mostly from:

- historical stats
- opportunity metrics
- team environment features
- depth-chart / usage context

### Recommendation Layer

The recommendation layer answers:

- how valuable is this player to my roster right now?

Inputs should include:

- prediction-layer outputs
- Sleeper market value
- FantasyPros expert value
- roster need
- scarcity
- next-pick survival
- stack / correlation preferences if added later

Team need belongs here, not inside the base player prediction model.

## Recommendation Formula Direction

The current recommendation engine is still mostly a heuristic scorer. The intended long-term shape is:

`recommendation_score = expert_value + market_value + projection_value + opportunity_value + environment_value + roster_need + urgency - risk`

Signal families:

- `expert_value`: FantasyPros current rank / projection stance
- `market_value`: FantasyPros vs Sleeper delta
- `projection_value`: projected points and value over replacement
- `opportunity_value`: expected points, target share, carry share, route/usage proxies
- `environment_value`: derived team environment
- `roster_need`: lineup and construction pressure
- `urgency`: chance player is gone by next pick
- `risk`: injury, fragility, uncertainty

## Expected Improvement

The project should not claim a fixed performance gain from the model without backtesting.

Expected practical benefit:

- modest improvement early in drafts
- larger improvement in middle and later rounds
- much better tie-breaking between similarly ranked players
- better roster-aware selection than expert-rank comparison alone

How to measure it:

- historical backtests
- hit rate on top-N recommendations
- realized season points / VOR from drafted players
- regret analysis by pick
- comparison of FantasyPros-only heuristics vs the multi-source model

## Recommended Build Order

1. Finish the real FantasyPros API adapter.
2. Normalize IDs cleanly across Sleeper, FantasyPros, and nflverse-derived data.
3. Replace manual `team-environment.json` with a derived pipeline based on nflreadpy / nflverse.
4. Add ffopportunity-style expected fantasy points / opportunity features.
5. Build the first prediction layer on top of the historical dataset.
6. Upgrade the recommendation engine to consume prediction outputs.

Why this order:

- FantasyPros comparison is the shortest path to a better current product
- the prediction layer will be stronger once the feature base is stable
- building the model before the data foundation is fixed would create more rework

## Immediate Decisions

These are the current agreed defaults unless changed later:

- `FantasyPros` is the primary current expert/projection/news source.
- `Sleeper` is the live draft and market source.
- `nflreadpy` / `nflverse` is the historical modeling and team-environment source.
- `Fantasy Football Data Pros` is not a core dependency.
- team environment should be derived, not manually curated.
- team need should stay in the recommendation layer, not the prediction layer.

## Sources

- FantasyPros API docs: https://api.fantasypros.com/v2/docs
- FantasyPros terms: https://api.fantasypros.com/public/v2/terms-of-use
- nflreadpy docs: https://nflreadpy.nflverse.com/
- nflreadpy load functions: https://nflreadpy.nflverse.com/api/load_functions/
- nflverse overview: https://nflverse.nflverse.com/
- nflverse data schedule: https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html
- nflverse team stats: https://nflreadr.nflverse.com/reference/load_team_stats.html
- nflverse team stats dictionary: https://nflreadr.nflverse.com/articles/dictionary_team_stats.html
- nflverse-data repository: https://github.com/nflverse/nflverse-data
- ffopportunity: https://github.com/ffverse/ffopportunity
- fantasy player IDs: https://nflreadr.nflverse.com/reference/load_ff_playerids.html
- Fantasy Football Data Pros API page: https://www.fantasyfootballdatapros.com/our_api
