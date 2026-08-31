# Recommendation Backtest

Generated: 2026-08-31T04:10:02.302Z

This replay is roster-aware and walk-forward. Promotion requires both the
feature-family gate and the ECR release gate; a failure keeps the model experimental.

This is the fixed-board replay. The assumption-dependent companion is
[Counterfactual Recommendation Backtest](./counterfactual-recommendation-backtest.md).

Candidate declaration: **2026-predeclared-v1**.
Architectures, ridge penalties, and workload thresholds are fixed by that
declaration before the 2022–2025 outer folds. Changing it requires a new
backtest version.

## Promotion Gates

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
- Validated for live overrides: **false**
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
