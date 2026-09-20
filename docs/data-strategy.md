# Data strategy

Use this document when selecting a data source or changing which inputs may
influence Recommendations. Use [data-refresh.md](data-refresh.md) for refresh
commands and artifact ownership, and [modeling-duckdb.md](modeling-duckdb.md)
for historical joins, training, and backtests.

## Current source responsibilities

| Source | Responsibility | Implementation |
| --- | --- | --- |
| Sleeper | Primary League metadata and official picks; player IDs, status, and platform search rank. | [Provider adapter](../server/src/sleeper-adapter.ts), [player refresh](../scripts/src/fetch-sleeper-adp.ts) |
| Yahoo and ESPN | Official draft state for their connected drafts. Yahoo uses server polling; ESPN supplies observed browser snapshots through the extension. | [Yahoo adapter](../server/src/yahoo-adapter.ts), [ESPN observer](../extension/src/content/espn-page-bridge.ts) |
| FantasyPros | Current expert rankings, projections, news, and consensus redraft ADP in a local snapshot. | [API adapter](../scripts/src/fantasypros-api.ts), [snapshot refresh](../scripts/src/refresh-fantasypros-snapshot.ts) |
| Fantasy Football Calculator | Observed draft ADP for the requested scoring format and league size, with cached results and fallback to other market inputs. | [Market ADP provider](../server/src/fantasy-football-calculator.ts) |
| nflverse | Historical production, schedules, rosters, player IDs, team stats, participation, and play-by-play inputs. The scripts load published files directly through DuckDB. | [Prediction dataset](../scripts/src/build-prediction-dataset.ts) |
| ffopportunity / ffverse | Historical expected fantasy points and opportunity inputs. | [Prediction dataset](../scripts/src/build-prediction-dataset.ts) |
| DynastyProcess / ffverse | Historical rankings and cross-platform player IDs for offline joins and evaluation. | [Prediction dataset](../scripts/src/build-prediction-dataset.ts) |
| Imported league history | The Primary League's draft timing and manager tendencies. | [History import](../scripts/src/import-league-draft-history.ts), [survival model](../scripts/src/build-league-survival-model.ts) |
| nflverse / OverTheCap contract history | Optional contract context and a separate historical feature evaluation. | [Contract refresh](../scripts/src/refresh-contracts.ts), [contract backtest](../scripts/src/backtest-contract-years.ts) |
| FanDuel and DraftKings PDF exports | Optional over/under and milestone evidence from local imports. | [Sportsbook importer](../scripts/import-sportsbook-lines.py) |

Sleeper is the authority for the Primary League, while the app also supports
Yahoo and ESPN. Follow the [outage recovery rules](primary-league-rehearsal.md#outage-recovery-rules)
when changing outage recovery or reconciliation.

FantasyPros supplies current expert evidence. Historical model evaluation uses
nflverse, ffopportunity, and stored ranking history. A current projection or news
snapshot is not evidence of what was known before an earlier draft.

## Player quality and draft timing

Best Player follows the FantasyPros ECR Anchor. Market ADP describes the cost
of acquiring a player and helps estimate whether that player will return at the
manager's next selection. Sleeper `search_rank` is a platform ordering proxy,
not observed draft ADP. Preserve that distinction in labels and calculations.

The league-history survival model combines the room's past drafts with current
market context. Keep timing evidence separate from player quality so a player
becoming more popular does not automatically make them a better player.

Current market fallback and player matching live in
[player-value.ts](../web-app/src/lib/calculations/player-value.ts); return
probabilities are calculated in
[survival.ts](../web-app/src/lib/calculations/survival.ts).

## Live Decision Policy

The live hook selects `best-pick-policy`. Best Pick combines the ECR Anchor
with bounded league value, roster fit, tier supply, and Draft Timing over the
Next-Pick Horizon. Conservative overrides stay near the ECR leader or within
the permitted tier boundary, except when a legal completed roster requires an
exception. Best Player remains available as the player-quality comparison.

Use [best-pick-policy.ts](../web-app/src/lib/calculations/best-pick-policy.ts)
for score bounds and selection rules, and
[useRecommendations.ts](../web-app/src/hooks/useRecommendations.ts) for the
live draft inputs. PickEV remains an implementation used by experimental and
comparison paths; it is not the architecture selected by the live hook.

The live player pool uses current rankings, league-scored FantasyPros
projections, news/status, identities, team environment, and market context.
[recommendation-player-variants.ts](../web-app/src/lib/calculations/recommendation-player-variants.ts)
keeps experimental predictions, contract context, and sportsbook context out
of the live player records. That separation applies even when optional
artifacts are fresh or a backtest reports an improvement.

## Experimental predictions and optional evidence

The historical pipeline predicts player production using trailing production,
opportunity, availability, and role features. Roster need belongs in the
recommendation step, where the manager's current draft state is known.

Experimental predictions enter a separate Shadow Recommendation player pool
when prediction data is ready and shadow logging is enabled. The app logs the
shadow result beside the live decision for later evaluation. A shadow result
cannot change the displayed Best Pick or Best Player.

Contract and sportsbook inputs remain informational. The contract backtest
records validation evidence while keeping `contractSignalEnabled` false.
[recommendation-policy.json](../data/recommendation-policy.json) records
backtest outcomes and shadow settings; it does not bypass the live player-pool
boundary. Promoting a model or optional signal requires an explicit change to
the Decision Policy and its verification.

Use the [data requirements](data-refresh.md#core-data-and-optional-signals)
when deciding whether a missing or stale input should block live use. The
[current readiness definitions](../shared/src/draft-readiness.ts) own the age
limits and corrective actions.

## Team environment and availability

[generate-team-env.ts](../scripts/src/generate-team-env.ts) derives the current
team-environment baseline from the latest completed nflverse season. Coaching
continuity is not sourced and defaults to `false`; current offseason roster,
depth-chart, and coaching changes are not part of that baseline. Do not present
those defaults as observed changes.

A richer team-environment model remains future work. Add inputs such as pace,
red-zone usage, or coaching continuity only with a reproducible source and a
backtest that establishes what the extra input contributes.

Keep injury availability and projection uncertainty distinct. Historical
features must respect the exact draft cutoff; date-only observations and
missing timestamps follow the rules in
[the modeling guide](modeling-duckdb.md#historical-draft-morning-snapshots).
Current status comes from the current FantasyPros and Sleeper inputs.

## Evaluating a source or policy change

Use historical backtests to compare the candidate with the existing model and
ECR baseline. Report held-out seasons, roster outcomes, regret, and limitations.
Do not infer a performance gain from a plausible feature or an in-sample fit.
The [modeling guide](modeling-duckdb.md#position-specific-prediction-layer)
describes the declared candidate set and walk-forward evaluation.

Underdog best-ball ADP and Fantasy Football Data Pros are not runtime
dependencies. If either is proposed, establish its format, season coverage,
permitted use, and measured value before adding it. Best-ball market evidence
needs an explicit mapping to this league's format before affecting draft timing.
