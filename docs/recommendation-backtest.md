# Recommendation Backtest

Generated: 2026-11-25T08:31:22.063Z

This replay is roster-aware and walk-forward. Promotion requires both the
feature-family gate and the ECR release gate; a failure keeps the model experimental.

This is the fixed-board replay. The assumption-dependent companion is
[Counterfactual Recommendation Backtest](./counterfactual-recommendation-backtest.md).

Candidate declaration: **2026-predeclared-v1**.
Architectures, ridge penalties, and workload thresholds are fixed by that
declaration before the 2022–2025 outer folds. Changing it requires a new
backtest version.

## Promotion Gates

Decision (2026-11-24): the prediction model failed this gate, so its feature-family work is frozen and it stays
as Shadow Recommendation logging only. It may be reopened only if the unchanged declaration beats roster-aware
ECR on every release check applied to the completed 2026 prospective fold alone. See [modeling-duckdb.md](./modeling-duckdb.md#status-frozen-as-shadow-recommendation-2026-11-24).

- Promoted: **false**
- Decision: At least one promotion gate fails; keep the model in Shadow Recommendation and out of live ordering.

### Feature gate

- Passed: **false**
- Decision: The new feature family does not improve aggregate out-of-sample starter points over the previous model.

| Check | Result |
| --- | --- |
| outOfSampleStarterPointsImprovePreviousModel | fail |

### Release gate

- Passed: **false**
- Decision: Model does not clear the ECR comparison gate; keep it experimental and do not claim an edge.
- Seasons won: 1 / 4 (required 3)
- Complete four-season evaluation: **true**

| Check | Result |
| --- | --- |
| seasonsWon | fail |
| aggregateStarterPointsBeatEcr | fail |
| aggregateVorBeatEcr | fail |
| averageRegretBeatEcr | fail |
| top24HitRateNonInferior | fail |
| noSeasonStarterRegressionOver15Percent | fail |

## Aggregate Strategy Comparison

| Strategy | Picks | VOR captured | Starter points | Average regret | Top-24 hit rate |
| --- | ---: | ---: | ---: | ---: | ---: |
| Actual user draft | 49 | 1061.98 | 8316.06 | 114.75 | 0.62 |
| Roster-aware ECR | 49 | 2015.9 | 8774.3 | 105.91 | 0.69 |
| Baseline roster-aware model | 49 | 1447.92 | 8412.06 | 133.49 | 0.61 |
| Roster-aware model | 49 | 1300.26 | 8368.2 | 136.5 | 0.59 |

## Prospective Folds

Seasons drafted after the 2026-predeclared-v1 declaration was frozen. Their outcomes could not
shape the declaration, so a complete prospective season that passes the release gate is the only evidence that
reopens the model (see [modeling-duckdb.md](./modeling-duckdb.md#status-frozen-as-shadow-recommendation-2026-11-24)).
A fold stays provisional, and outside every gate and aggregate above, until all 272 of its
regular-season games are scored and matched to weekly player stats; completeness comes from nflverse, not a flag. Refresh outcomes with `pnpm model:prospective`.

- Reopen eligible: **false**

### 2026: **PROVISIONAL**

- Regular season: 163 of 272 scheduled games scored (272 in a full season); 163 matched to weekly player stats, through week 11 (outcomes fetched 2026-11-25T00:27:54Z).
- Excluded from the release gate until all 272 regular-season games are scored and matched to player stats; the numbers move each week.
- Outcomes: Season-to-date nflverse regular-season totals from scored games with player stats, scaled to a 17-game pace by each player's matched team games.
- Coverage: 12 of 13 user picks scored.
- Board: 223 offensive players ranked inside the top 250 in the last snapshot before the draft; 0 player rankings scraped after the draft started were excluded before that selection; 0 drafted players without a draft-day rank were added so their picks and keepers score.
- Shadow Recommendation log: absent (no `data/shadow-logs/2026-recommendations.ndjson`), so only the replayed model is scored.

| Strategy | Picks | VOR captured | Starter points | Average regret | Top-24 hit rate |
| --- | ---: | ---: | ---: | ---: | ---: |
| Actual user draft | 12 | 567.81 | 2252.43 | 152.47 | 0.58 |
| Roster-aware ECR | 12 | 864.76 | 2593.24 | 127.73 | 0.92 |
| Best Pick (shipped) | 12 | 819.54 | 2482.57 | 131.5 | 0.83 |
| Baseline roster-aware model | 12 | 433.99 | 2341.57 | 182.51 | 0.5 |
| Roster-aware model | 12 | 102.79 | 2027.02 | 229.46 | 0.5 |

Single-season release gate (model must beat roster-aware ECR on every release check this season; seasons won does not apply): **fail** (provisional, not counted)

| Check | Result |
| --- | --- |
| aggregateStarterPointsBeatEcr | fail |
| aggregateVorBeatEcr | fail |
| averageRegretBeatEcr | fail |
| top24HitRateNonInferior | fail |
| noSeasonStarterRegressionOver15Percent | fail |


## Best Pick Policy

The shipped Best Pick rule, called through the same function the Assistant uses, on each historical board. The rejected-weights row replays the same rule with
the starter window at 12 ranks and the late starter bonus
multiplied by 2, the tuning 09781a5 shipped and this report
rejected. Negative regret deltas are improvements.

- Inputs: Expert rank, walk-forward projection and value over replacement. Live-feed inputs (news, bye weeks, contract and environment signals) take neutral values.

| Strategy | Picks | VOR captured | Starter points | Average regret | Top-24 hit rate |
| --- | ---: | ---: | ---: | ---: | ---: |
| Roster-aware ECR | 49 | 2015.9 | 8774.3 | 105.91 | 0.69 |
| Best Pick (shipped weights) | 49 | 1909.16 | 8670.64 | 103.99 | 0.72 |
| Best Pick (rejected 12/2 weights) | 49 | 1648.7 | 8715.44 | 109.3 | 0.67 |

| Comparison | Starter points | VOR captured | Average regret | Top-24 hit rate |
| --- | ---: | ---: | ---: | ---: |
| bestPickVsEcr | -103.66 | -106.74 | -1.92 | 0.03 |
| bestPickVsRejectedWeights | -44.8 | 260.46 | -5.31 | 0.05 |

| Season | Roster-aware ECR | Best Pick | Best Pick, rejected weights |
| ---: | ---: | ---: | ---: |
| 2022 | 2333.7 | 2333.7 | 2333.7 |
| 2023 | 2284.7 | 2224.42 | 2224.42 |
| 2024 | 1708.52 | 1840.34 | 1885.14 |
| 2025 | 2447.38 | 2272.18 | 2272.18 |

### Best Pick regression gate

`pnpm verify` checks these records without league data (scripts/src/best-pick-backtest-gate.test.ts). It fails
when either block is missing, when `shared/src/draft/calculations/best-pick-policy.ts`, `shared/src/draft/calculations/recommendations.ts` and the
shared/src modules they reach through runtime imports no longer hash to the gate block's `policySourceHash`, when
the gate block does not cover the 2022–2025 folds with the baseline's draft picks, or when Best Pick's margin over roster-aware ECR is more than
25 VOR or 1 average
regret worse than the accepted baseline. Regenerating copies the baseline block unchanged; only
`pnpm model:backtest:accept-best-pick` replaces it with the current replay, so a baseline change is always a
reviewed diff. A partial replay, or one whose Best Pick and ECR picks differ, stops the run before any report is
written.

- Gate: **pass**

<!-- best-pick-gate:start -->
```json
{
  "version": 3,
  "policySourceHash": "sha256:832ddf42dfa6d3ea2e7bc001467be68d1b9986cf074ea4158b819b4ec97ce1de",
  "folds": [
    {
      "season": 2022,
      "pickNumbers": [7, 14, 27, 34, 47, 54, 67, 74, 87, 94, 107, 114, 127]
    },
    {
      "season": 2023,
      "pickNumbers": [6, 15, 26, 35, 46, 55, 66, 75, 86, 95, 115, 126]
    },
    {
      "season": 2024,
      "pickNumbers": [8, 17, 24, 48, 53, 57, 68, 73, 88, 93, 108, 128]
    },
    {
      "season": 2025,
      "pickNumbers": [8, 13, 28, 33, 48, 53, 68, 88, 93, 108, 128, 133]
    }
  ],
  "bestPickVsEcr": {
    "starterPoints": -103.66,
    "vorCaptured": -106.74,
    "averageRegret": -1.92,
    "top24PositionHitRate": 0.03
  }
}
```
<!-- best-pick-gate:end -->

<!-- best-pick-baseline:start -->
```json
{
  "version": 3,
  "policySourceHash": "sha256:832ddf42dfa6d3ea2e7bc001467be68d1b9986cf074ea4158b819b4ec97ce1de",
  "folds": [
    {
      "season": 2022,
      "pickNumbers": [7, 14, 27, 34, 47, 54, 67, 74, 87, 94, 107, 114, 127]
    },
    {
      "season": 2023,
      "pickNumbers": [6, 15, 26, 35, 46, 55, 66, 75, 86, 95, 115, 126]
    },
    {
      "season": 2024,
      "pickNumbers": [8, 17, 24, 48, 53, 57, 68, 73, 88, 93, 108, 128]
    },
    {
      "season": 2025,
      "pickNumbers": [8, 13, 28, 33, 48, 53, 68, 88, 93, 108, 128, 133]
    }
  ],
  "bestPickVsEcr": {
    "starterPoints": -103.66,
    "vorCaptured": -106.74,
    "averageRegret": -1.92,
    "top24PositionHitRate": 0.03
  }
}
```
<!-- best-pick-baseline:end -->

## PickEV Architecture Comparison

This comparison replays the legacy projection/VOR architecture and each PickEV
layer independently. Negative regret deltas are improvements. These are
architecture results using the historical proxies below, not evidence about
unavailable historical FantasyPros or observed ADP data.

- Projections: Historical leakage-safe shared projection proxy; historical FantasyPros snapshots are not available.
- ADP: Historical pre-draft consensus rank proxy; observed historical player-level ADP is not available.
- Risk: Informational only; dated injury replay is not yet available, so risk is excluded from selection.
- Late option value: History-length uncertainty is the leakage-safe late-round ceiling proxy.

### PickEV override gate

- Candidate threshold: 4 PickEV points
- Historical override gate passed: **false**
- ECR remains the champion whenever this gate fails.

| Architecture | Picks | VOR captured | Starter points | Average regret | Top-24 hit rate |
| --- | ---: | ---: | ---: | ---: | ---: |
| ecrAnchor | 49 | 2015.9 | 8774.3 | 105.91 | 0.69 |
| legacyProjectionVor | 49 | 1447.92 | 8412.06 | 133.49 | 0.61 |
| ecrWaitingOnly | 49 | 2006.88 | 8447.9 | 101.99 | 0.72 |
| pickEvProjection | 49 | 1887.58 | 8777.42 | 103.39 | 0.7 |
| pickEvWaiting | 49 | 1774.68 | 8598.52 | 106.86 | 0.72 |
| pickEvOption | 49 | 1774.68 | 8598.52 | 106.86 | 0.72 |
| pickEvFull | 49 | 1831.18 | 8598.52 | 105.7 | 0.72 |

### Incremental layer deltas

| Comparison | Starter points | VOR captured | Average regret | Top-24 hit rate |
| --- | ---: | ---: | ---: | ---: |
| ecrWaitingOnlyVsEcr | -326.4 | -9.02 | -3.92 | 0.03 |
| projectionVsEcr | 3.12 | -128.32 | -2.52 | 0.01 |
| waitingVsProjection | -178.9 | -112.9 | 3.47 | 0.02 |
| optionVsWaiting | 0 | 0 | 0 | 0 |
| fullVsLegacy | 186.46 | 383.26 | -27.79 | 0.11 |
| fullVsEcr | -175.78 | -184.72 | -0.21 | 0.03 |

## Position-model Ablation

- Starter points delta vs baseline: -43.86
- VOR delta vs baseline: -147.66
- Average regret delta vs baseline: 3.01
- Top-24 hit-rate delta vs baseline: -0.02

## Walk-Forward Folds

| Test season | Prior league seasons | Frozen position specifications | ECR starter points | Baseline model | Expanded model | Winner |
| --- | --- | --- | ---: | ---: | ---: | --- |
| 2022 | none | QB:expanded-efficiency-v1 (λ=100, v=200)<br>RB:expanded-efficiency-v1 (λ=100, v=80)<br>WR:expanded-efficiency-v1 (λ=100, v=80)<br>TE:expanded-efficiency-v1 (λ=100, v=200) | 2333.7 | 1895.32 | 1895.32 | ecr |
| 2023 | 2022 | QB:expanded-efficiency-v1 (λ=1000000000, v=200)<br>RB:expanded-efficiency-v1 (λ=1000000000, v=80)<br>WR:expanded-efficiency-v1 (λ=1000000000, v=80)<br>TE:expanded-efficiency-v1 (λ=1000000000, v=200) | 2284.7 | 2168.14 | 2168.14 | ecr |
| 2024 | 2022, 2023 | QB:expanded-efficiency-v1 (λ=1, v=50)<br>RB:role-opportunity-v1 (λ=10, v=320)<br>WR:expanded-efficiency-v1 (λ=1, v=20)<br>TE:role-opportunity-v1 (λ=1, v=800) | 1708.52 | 2111.94 | 2086.78 | model |
| 2025 | 2022, 2023, 2024 | QB:workload-only-v1 (λ=100, v=800)<br>RB:role-opportunity-v1 (λ=10000, v=20)<br>WR:expanded-efficiency-v1 (λ=100, v=20)<br>TE:expanded-efficiency-v1 (λ=10, v=800) | 2447.38 | 2236.66 | 2217.96 | ecr |

## Limitations

- Historical opponent picks are held fixed; the replay does not simulate replacement picks when a strategy takes a player an opponent selected later.
- The 2022 fold uses the predeclared cold-start fallback because only one earlier dataset season is available; it contributes release-gate coverage but does not separate the expanded feature family from the previous model.
- The architecture-selection replay has only the four predeclared 2022–2025 outer folds, although residual fitting uses earlier player-season rows.
- Injuries known on each historical draft date and manager-specific opponent behavior are not yet replayed.
- PickEV architecture ablations use historical projection, ADP, and risk proxies; they compare scoring architecture now but cannot establish the incremental value of true historical FantasyPros and observed ADP inputs.
- The sample contains only four outer seasons and should be treated as a product gate, not statistical proof of superiority.
