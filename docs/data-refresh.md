# Data Refresh Policy

`pnpm dev` starts local watchers and servers. Its `predev` check writes only
`data/data-quality-report.json`; it does not refresh the other tracked JSON or
make network-heavy requests. Use explicit refresh commands so a normal coding
session remains fast and reproducible.

## Commands

| Command | Purpose | When to run |
| --- | --- | --- |
| `pnpm data:check` | Reports freshness and writes `data/data-quality-report.json`. | Any time; runs before `pnpm dev`. |
| `pnpm data:check:strict` | Fails on stale or invalid required artifacts. | The end of `pnpm prepare:draft`. |
| `pnpm draft:preflight` | Refreshes the Sleeper directory and FantasyPros rankings, rebuilds canonical identities, then validates the local Core Draft Data needed before a provider connection. | Immediately before starting the live draft workspace. |
| `pnpm dev:live` | Runs `pnpm draft:preflight`, regenerates the draft prep report without making report failure a startup blocker, and starts the local app only if Core Draft Data passes. | Draft day. |
| `pnpm draft:readiness` | Evaluates Core Draft Data, warnings, and Optional Signal degradation separately; writes `data/draft-readiness-report.json` and exits nonzero only for Core Draft Data blockers. | Manually before draft use and in the scheduled Draft Readiness workflow. |
| `pnpm draft:rehearsal` | Runs the deterministic 140-pick Primary League outage and reconciliation scenario. | After draft-state or Recommendation changes and before the real-provider rehearsal. |
| `pnpm draft:release-gate` | Records build, type-check, lint, unit, integration, data-quality, product-rehearsal, and real-provider evidence separately. | Before feature freeze and after the real-provider rehearsal. |
| `pnpm refresh:sleeper` | Refreshes `data/sleeper-adp.json` from Sleeper player `search_rank`. | Daily during draft week. |
| `pnpm refresh:fantasypros` | Refreshes rankings, projections, and news. | Daily during draft week and shortly before drafting. |
| `pnpm import:sportsbook` | Normalizes the FanDuel and DraftKings PDF exports into `data/sportsbook-snapshot.json`. | After replacing any file in `betting-lines-pdfs/`. |
| `pnpm data:identity` | Builds the canonical Sleeper/FantasyPros player crosswalk. | After either market source changes. |
| `pnpm refresh:contracts` | Builds current contract context from nflverse/OverTheCap history. | Weekly during the offseason and before draft prep. |
| `pnpm model:snapshots` | Rebuilds strict as-of-draft historical injury, roster, depth, competition, and transaction context. | After historical draft/source changes; also runs inside `model:dataset`. |
| `pnpm refresh:team-env` | Derives `data/team-environment.json` from the latest completed nflverse season. | Weekly during the offseason or after pipeline changes. |
| `pnpm refresh:daily` | Runs Sleeper, FantasyPros, identity, contract, and team-environment refreshes. | Draft week. |
| `pnpm prepare:draft` | Refreshes daily data, rebuilds DuckDB predictions and survival data, runs the backtest, and writes the prep report. | Draft week and after scoring/model changes. |
| `pnpm model:backtest` | Replays the recommendation model, rewrites the fixed-board and counterfactual reports, and updates recommendation policy. | After prediction, scoring, league-history, recommendation, or backtest changes, and once during final draft preparation. |
| `pnpm model:backtest:contracts` | Runs the leakage-safe 2012–2025 contract-year feature ablation. | After contract/model logic changes and before enabling the signal. |
| `pnpm report:draft-prep` | Rewrites the prep report from existing artifacts. | After late keeper edits. |

`pnpm verify` is the deterministic code gate used by pull requests. Freshness is
checked separately by `.github/workflows/draft-readiness.yml`, which runs daily
during July through September and can be dispatched manually. This keeps normal
code CI independent of the wall clock while still surfacing stale draft data.
The generated Draft Readiness report records build, type-check, lint, and test as
separate, not-run engineering checks; those results never substitute for the
product readiness result.

The live preflight does not update `confirmedAt` in
`data/primary-league-settings.json`. The saved confirmation remains valid for
its declared season and does not expire with age. Update it only after verifying
a new season, draft, league, scoring configuration, or roster configuration.
Run `pnpm dev:live`, then connect the Primary League draft. The connected
provider settings are the live authority for scoring and roster confirmation.

## Artifact Ownership

| Artifact | Source | Notes |
| --- | --- | --- |
| `data/fantasypros-snapshot.json` | FantasyPros API or manual fallback | Current ECR, consensus PPR ADP, projections, and news. |
| `data/sportsbook-snapshot.json` | FanDuel and DraftKings PDF exports | Over/under consensus inputs plus raw milestone implied-probability signals. |
| `data/sleeper-adp.json` | Sleeper `/v1/players/nfl` | `search_rank` proxy only; it is not observed-draft ADP. |
| `data/player-identity.json` | Generated from FantasyPros and Sleeper | Canonical IDs, aliases, and explicit team-defense mappings. |
| `data/data-quality-report.json` | Generated validator report | Counts, joins, seasons, dependency order, warnings, and failures. |
| `data/draft-readiness-report.json` | Generated Draft Readiness evaluator | Product-blocking Core Draft Data failures, actionable warnings, Optional Signal degradation, and separately identified engineering checks. |
| `data/primary-league-rehearsal.json` | Sleeper draft metadata plus operator confirmation | Exact draft and league IDs, scheduled timing, confirmed 14-round configuration, and real-provider rehearsal status. Deterministic tests do not depend on this file. |
| `data/primary-league-deterministic-rehearsal-report.json` | Deterministic product rehearsal | Transition checks, reconciliation outcomes, final pick integrity, rosters, and remaining availability. |
| `data/primary-league-release-gate-report.json` | Release-gate runner | Separate engineering, data-quality, deterministic product, real-provider, warning, and Optional Signal outcomes. |
| `data/primary-league-settings.json` | Provider-confirmed Primary League profile | Season-scoped acceptance configuration for the 10-team, 14-round league. It does not expire with age; refresh `confirmedAt` only after verifying a new season, draft, league, scoring configuration, or roster configuration. |
| `data/team-environment.json` | nflverse completed-season team stats | Reproducible baseline; offseason changes remain separate signals. |
| `data/contracts.json` | nflverse historical contracts sourced from OverTheCap | Current context is populated; recommendation influence remains policy-disabled until separately backtested. |
| `data/predictions.json` | DuckDB prediction pipeline | Includes league scoring plus leakage-safe trailing snap-share and Next Gen Stats adjustments. |
| `data/recommendation-policy.json` | Roster-aware walk-forward backtest | Enables model predictions only after both the feature-family and ECR release gates pass. |
| `data/shadow-logs/2026-recommendations.ndjson` | Live app, append-only and gitignored | Records model/fallback decision pairs without exposing the experimental recommendation. |
| `data/league-history/survival-model.json` | Imported league draft history plus Sleeper proxy | Room-specific timing adjustment, not player-quality training data. |
| `data/league-history/current-keepers.json` | Manual late draft-week input | Add every keeper, mark the user's entry with `isMyKeeper`, and set `updatedAt` only when the full list is confirmed. A confirmed list remains valid for its declared season and does not expire with age. The live mock preloads this file before pick 1. |
| `data/draft-prep-report.json` | Generated report | Machine-readable draft-week summary. |

The web build publishes only the files listed in
`scripts/src/browser-data.ts`. Raw sportsbook lines and the current keeper list
remain server-owned inputs and are delivered to the local app through
`/api/draft-data/*`; they must not be copied into `web-app/dist/data`.

## External Market Context

Underdog best-ball ADP is a useful secondary signal for broad market movement.
The current external reference is Sharp Football Analysis's
[Underdog half-PPR table](https://www.sharpfootballanalysis.com/fantasy/fantasy-football-adp-half-ppr-underdog-best-ball/).
It should remain contextual because the scoring format and best-ball
roster-construction objective differ from this keeper league.
