# Data strategy

Last updated: August 26, 2026

This document is the current source of truth for:

- which data sources the project should use
- which sources should not be primary dependencies
- where future work should take the derived team-environment baseline
- how prediction and recommendation should be separated
- the recommended implementation order

## Summary

The project should use a multi-source model with clear responsibilities:

- `Sleeper`: the product-wide provider for live draft state and platform market context
- `FantasyPros`: current expert rankings, current projections, current news
- `Underdog best-ball ADP`: external market-temperature context only
- `nflreadpy` / `nflverse`: historical model-training data, inputs for the future Team Environment V2 target, player/team ID mapping, depth charts, schedules, rosters, team stats
- `ffopportunity` / ffverse data via nflverse tooling: expected fantasy points and opportunity signals

The project should not use FantasyPros as the historical modeling foundation, and it should not depend on Fantasy Football Data Pros as a primary current-season source.

PickEV is the live recommendation path. The experimental prediction model stays
in shadow evaluation unless it clears the promotion gates.

## Source Decisions

### Sleeper

Use Sleeper across the Fantasy Draft Assistant as Provider Truth for:

- league and draft metadata
- live draft state
- draft picks
- current platform search/order rank as a secondary market signal
- provider player IDs

Why:

- Sleeper is the supported provider for the whole product, not an integration scoped only to the Primary League
- the Primary League defines the current acceptance criteria, but it does not define the boundary of the Sleeper integration
- sync latency matters more than model richness here
- it gives the current market view that users are actually drafting against

### FantasyPros

Use FantasyPros for:

- current consensus rankings
- current expert projections
- current news / injury items
- consensus redraft ADP as the primary observed market-cost signal

Do not use FantasyPros as the historical model-training base.

Why:

- it is the best current expert signal available to this project
- it directly powers the expert-vs-market comparison users care about
- its current API terms are personal, non-commercial, and explicitly restrict some historical/statistical uses

Practical implication:

- the project should ingest FantasyPros into a cached local snapshot
- the app should not depend on repeated live requests during the draft
- the recommendation engine should treat FantasyPros as one current-season signal family, not the whole system

### Underdog Best-Ball ADP

Use Underdog best-ball ADP only as an external market-temperature signal:

- monitor broad positional movement and large player risers/fallers
- compare it with home-league and Sleeper signals during draft prep
- do not replace home-league survival estimates with it
- do not feed it directly into recommendation scoring without normalization

Why:

- Underdog best ball is half PPR
- roster construction and optimal strategy differ from this keeper league
- it is still useful because active drafts reveal current market movement earlier than many home-league feeds

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

Team Environment V2 is a future target. The current `team-environment.json` is
already a reproducible baseline derived from the latest completed nflverse
season, but it is not the complete design described below.

Current baseline:

- [`scripts/src/generate-team-env.ts`](../scripts/src/generate-team-env.ts) derives team offense, pass volume, and rush volume from touchdowns, yards, attempts, and EPA
- coaching continuity is not sourced and defaults to `false`
- current offseason roster, depth-chart, and coaching changes are not part of the artifact

Future target:

- expand `data/team-environment.json` into a richer derived feature set without turning offseason judgment into hand-maintained team labels

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

What Team Environment V2 should become:

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

## Live recommendation path: PickEV

PickEV is the live recommendation path. It uses an ECR-anchored scorer whose terms are
expressed as expected roster utility rather than unrelated rank and 1–10 point
bonuses:

`pickEV = ecr_anchor + projection_residual + marginal_roster_value + cost_of_waiting - risk_adjusted_loss`

Consensus ADP is not a player-quality bonus. It supplies the price/survival
estimate used by `cost_of_waiting`. Roster need and positional scarcity are not
separate bonuses; together they determine the roster value lost if the current
player is gone and the best next-pick alternative is worse.

Signal families:

- `ecr_anchor`: calibrated FantasyPros consensus quality prior
- `projection_residual`: league-scored projection value not already implied by nearby ECR
- `marginal_roster_value`: dynamic VOR weighted by starter, FLEX, and bench utility
- `cost_of_waiting`: probability of loss before the next pick times the next-alternative drop
- `risk_adjusted_loss`: expected roster utility lost to availability and outcome uncertainty

### Availability Risk

Keep availability and uncertainty as separate model signals:

- Historical backtests use exact draft-start cutoffs. Injury, roster, depth,
  team, competition, and transaction context is admitted only when its
  information timestamp is at or before that cutoff.
- Date-only observations use the following midnight UTC as their conservative
  availability upper bound; records with no timestamp remain missing.
- End-of-season roster/depth state and Week 1 records with unknown publication
  time are never backfilled into preseason snapshots.
- Snapshot context can change projected availability or role assumptions, but
  it never awards or removes fantasy points directly.

- `injuryRiskScore` is the availability-risk score. It uses the greater of current status risk and historical availability risk.
- Current status risk comes from FantasyPros news and Sleeper status. Active or unknown status has a neutral baseline of `2`; limited, questionable, PUP, IR, and out statuses raise it.
- Historical availability risk uses missed games from the previous three seasons with recency weights of `1.0`, `0.6`, and `0.3`.
- Historical missed games only count when the player had a meaningful prior season: at least eight games plus a position-adjusted fantasy-points-per-game threshold. This avoids treating late-emerging starters as injured.
- Rookies and players without history keep the neutral historical availability baseline of `2`.
- The UI keeps the model's availability and uncertainty outputs as
  informational signals even while experimental point projections remain
  disabled. Overall risk starts with availability risk and adds 35% of
  projection volatility above its neutral baseline, with the two inputs shown
  separately as `Availability / Volatility`.
- PickEV converts availability and uncertainty into projected VOR loss, with a
  larger downside-aversion coefficient early in the draft and a smaller one in
  later upside rounds.

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

The generated `data/recommendation-policy.json` is the promotion boundary. A
new feature family must first improve the previous model on the four untouched
walk-forward seasons. The complete model must then clear every roster-aware ECR
release check. If either gate fails, the web app keeps model predictions out of
live scoring and continues to use ECR-anchored PickEV with validated
current-season signals.

During the 2026 draft, the app scores the experimental model in a separate
shadow player pool and records its top recommendation alongside the live PickEV
recommendation. Shadow results never enter the displayed or live score. The
append-only log at `data/shadow-logs/2026-recommendations.ndjson` can be joined
to post-season outcomes to score only decisions that were recorded before the
result was known.

## Recommended Build Order

1. Finish the real FantasyPros API adapter.
2. Normalize IDs cleanly across Sleeper, FantasyPros, and nflverse-derived data.
3. Expand the derived team-environment baseline into the future Team Environment V2 pipeline using nflreadpy / nflverse.
4. Add ffopportunity-style expected fantasy points / opportunity features.
5. Build the first prediction layer on top of the historical dataset.
6. Promote validated prediction outputs into the live PickEV path only after they clear the release gates.

Why this order:

- FantasyPros comparison is the shortest path to a better current product
- the prediction layer will be stronger once the feature base is stable
- building the model before the data foundation is fixed would create more rework
- PickEV remains the live path while future features are built and evaluated

## Immediate Decisions

These are the current agreed defaults unless changed later:

- `FantasyPros` is the primary current expert/projection/news source.
- `Sleeper` is the product-wide live draft provider and market source, not only the Primary League provider.
- `nflreadpy` / `nflverse` is the historical modeling source and the intended source for Team Environment V2.
- `Fantasy Football Data Pros` is not a core dependency.
- the current team-environment artifact is a derived baseline; the richer Team Environment V2 design is a future target.
- PickEV is the live recommendation path; the experimental prediction model remains a shadow path until promotion.
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
