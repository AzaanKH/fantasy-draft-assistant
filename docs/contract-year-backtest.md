# Contract-Year Backtest

Generated: 2026-08-31T04:11:11.063Z

Provenance: command `pnpm model:backtest:contracts`; contract identifier `nflverse/contracts/historical_contracts.parquet`; prediction identifier `contract-year-walk-forward-ridge-v1`; historical-input identifier `nflverse-player-stats-and-season-rosters-2012-2025`.

This walk-forward ablation tests incremental predictive value. It does not
establish that motivation causes player performance.

## Promotion Gate

- Passed: **true**
- Decision: The contract-year feature clears the multi-season promotion gate. It remains read-only until a separate live-policy approval.
- Seasons with lower MAE: 10 / 11 (required 7)
- Contract-year player-seasons: 375

| Gate check | Result |
| --- | --- |
| minimumFiveTestSeasons | pass |
| minimumPlayerSeasonCoverage | pass |
| minimumContractYearCoverage | pass |
| allTestSeasonsPopulated | pass |
| aggregateMaeImproved | pass |
| aggregateRmseNonInferior | pass |
| aggregateVorMaeImproved | pass |
| aggregateVorCapturedNonInferior | pass |
| aggregateTop24NonInferior | pass |
| aggregateStarterPointsNonInferior | pass |
| aggregateDraftRegretNonInferior | pass |
| multipleSeasonsImproved | pass |

## Leakage Control

Only contracts with year_signed strictly before the evaluated season are eligible. Same-year signings and extensions are excluded because the source has no exact signing date.
The latest eligible deal is used. Conflicting end years among deals signed in the same latest year are treated as unknown and never marked as contract years.

## Aggregate Comparison

| Metric | Baseline | Plus contract year | Delta |
| --- | ---: | ---: | ---: |
| MAE | 55.3792 | 54.5699 | -0.8093 |
| RMSE | 76.3054 | 76.2795 | -0.0259 |
| VOR MAE | 61.5258 | 60.9198 | -0.606 |
| Top-24 accuracy | 0.6525 | 0.6572 | 0.0047 |
| Starter points | 141143.32 | 142424.08 | 1280.76 |
| Draft regret | 42170.42 | 40889.66 | -1280.76 |
| VOR captured | 29012.6 | 30326.88 | 1314.28 |

Negative error/regret deltas are improvements; positive accuracy/points/VOR deltas are improvements.

## Walk-Forward Seasons

| Test season | N | Baseline MAE | Contract MAE | Delta | Winner |
| --- | ---: | ---: | ---: | ---: | --- |
| 2015 | 309 | 57.8134 | 56.1271 | -1.6863 | contract |
| 2016 | 313 | 90.0661 | 90.0201 | -0.046 | contract |
| 2017 | 309 | 48.0558 | 46.3076 | -1.7482 | contract |
| 2018 | 286 | 55.3007 | 53.9024 | -1.3983 | contract |
| 2019 | 294 | 54.4358 | 52.8201 | -1.6157 | contract |
| 2020 | 310 | 53.1622 | 52.4414 | -0.7208 | contract |
| 2021 | 311 | 51.2644 | 51.3324 | 0.068 | baseline |
| 2022 | 310 | 48.0497 | 47.7129 | -0.3368 | contract |
| 2023 | 308 | 45.9226 | 45.6621 | -0.2605 | contract |
| 2024 | 295 | 53.2282 | 52.7159 | -0.5123 | contract |
| 2025 | 292 | 51.0637 | 50.3377 | -0.726 | contract |

## Breakdowns

### Position

| Bucket | N | Contract years | Baseline MAE | Contract MAE | Delta |
| --- | ---: | ---: | ---: | ---: | ---: |
| QB | 585 | 54 | 63.3128 | 63.2015 | -0.1113 |
| RB | 894 | 130 | 62.4606 | 60.8932 | -1.5674 |
| TE | 600 | 51 | 43.6413 | 42.9452 | -0.6961 |
| WR | 1258 | 140 | 52.2559 | 51.6067 | -0.6492 |

### Age

| Bucket | N | Contract years | Baseline MAE | Contract MAE | Delta |
| --- | ---: | ---: | ---: | ---: | ---: |
| 25-28 | 1354 | 177 | 49.89 | 48.5273 | -1.3627 |
| 29-plus | 701 | 152 | 50.1726 | 49.3357 | -0.837 |
| under-25 | 1187 | 46 | 58.9001 | 58.2998 | -0.6003 |
| unknown | 95 | 0 | 128.0412 | 132.7114 | 4.6702 |

### Experience

| Bucket | N | Contract years | Baseline MAE | Contract MAE | Delta |
| --- | ---: | ---: | ---: | ---: | ---: |
| rookie | 463 | 6 | 63.7985 | 63.9866 | 0.1881 |
| years-1-3 | 1284 | 108 | 51.0442 | 49.8793 | -1.1649 |
| years-4-7 | 1130 | 162 | 53.8777 | 53.0042 | -0.8735 |
| years-8-plus | 460 | 99 | 62.6939 | 62.0309 | -0.663 |

### ExpectedRole

| Bucket | N | Contract years | Baseline MAE | Contract MAE | Delta |
| --- | ---: | ---: | ---: | ---: | ---: |
| high | 698 | 72 | 72.8277 | 71.8387 | -0.989 |
| low | 984 | 137 | 38.7791 | 38.0233 | -0.7558 |
| medium | 1192 | 160 | 55.5951 | 54.4594 | -1.1357 |
| rookie-unknown | 463 | 6 | 63.7985 | 63.9866 | 0.1881 |

## Limitations

- The nflverse contract source provides signing year, not an exact transaction date, so all same-year contracts are conservatively excluded.
- Historical contract corrections made after the fact may still exist in the current source snapshot.
- nflverse does not expose consistent historical fantasy draft-date roster snapshots. Season roster records define the evaluation population, while every model feature remains limited to information from prior seasons.
- Starter points and regret use a 10-team league-wide starter pool (1 QB, 2 RB, 2 WR, 1 TE, 2 FLEX per team), not a pick-by-pick room simulation.
- The backtest does not prove a motivational contract-year effect; it only tests incremental out-of-sample prediction.
