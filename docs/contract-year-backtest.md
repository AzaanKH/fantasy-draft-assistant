# Contract-Year Backtest

Generated: 2026-08-29T20:52:53.825Z

This walk-forward ablation tests incremental predictive value. It does not
establish that motivation causes player performance.

## Promotion Gate

- Passed: **false**
- Decision: The contract-year feature does not clear the multi-season promotion gate; keep it disabled.
- Seasons with lower MAE: 9 / 11 (required 7)
- Contract-year player-seasons: 375

| Gate check | Result |
| --- | --- |
| minimumFiveTestSeasons | pass |
| minimumPlayerSeasonCoverage | pass |
| minimumContractYearCoverage | pass |
| allTestSeasonsPopulated | pass |
| aggregateMaeImproved | pass |
| aggregateRmseNonInferior | fail |
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
| MAE | 55.2611 | 54.4975 | -0.7636 |
| RMSE | 75.83 | 75.8647 | 0.0347 |
| VOR MAE | 61.3035 | 60.7518 | -0.5517 |
| Top-24 accuracy | 0.6581 | 0.6581 | 0 |
| Starter points | 141329.04 | 142263.06 | 934.02 |
| Draft regret | 41984.7 | 41050.68 | -934.02 |
| VOR captured | 29246.18 | 30023.06 | 776.88 |

Negative error/regret deltas are improvements; positive accuracy/points/VOR deltas are improvements.

## Walk-Forward Seasons

| Test season | N | Baseline MAE | Contract MAE | Delta | Winner |
| --- | ---: | ---: | ---: | ---: | --- |
| 2015 | 309 | 58.1851 | 56.4466 | -1.7385 | contract |
| 2016 | 313 | 89.1041 | 89.3266 | 0.2225 | baseline |
| 2017 | 309 | 47.8151 | 46.094 | -1.7211 | contract |
| 2018 | 286 | 55.246 | 53.8435 | -1.4025 | contract |
| 2019 | 294 | 54.158 | 52.7022 | -1.4558 | contract |
| 2020 | 310 | 53.1628 | 52.4755 | -0.6873 | contract |
| 2021 | 311 | 51.3067 | 51.3806 | 0.0739 | baseline |
| 2022 | 310 | 47.9444 | 47.6367 | -0.3077 | contract |
| 2023 | 308 | 45.7688 | 45.5851 | -0.1837 | contract |
| 2024 | 295 | 53.2516 | 52.7266 | -0.525 | contract |
| 2025 | 292 | 51.1446 | 50.3817 | -0.7629 | contract |

## Breakdowns

### Position

| Bucket | N | Contract years | Baseline MAE | Contract MAE | Delta |
| --- | ---: | ---: | ---: | ---: | ---: |
| QB | 585 | 54 | 63.1962 | 63.0719 | -0.1243 |
| RB | 894 | 130 | 62.2138 | 60.7404 | -1.4734 |
| TE | 600 | 51 | 43.6399 | 42.939 | -0.7009 |
| WR | 1258 | 140 | 52.1728 | 51.5864 | -0.5864 |

### Age

| Bucket | N | Contract years | Baseline MAE | Contract MAE | Delta |
| --- | ---: | ---: | ---: | ---: | ---: |
| 25-28 | 1408 | 176 | 50.3777 | 48.9453 | -1.4324 |
| 29-plus | 794 | 164 | 50.2967 | 49.6547 | -0.642 |
| under-25 | 1040 | 35 | 59.361 | 58.8529 | -0.5081 |
| unknown | 95 | 0 | 124.2469 | 129.5815 | 5.3346 |

### Experience

| Bucket | N | Contract years | Baseline MAE | Contract MAE | Delta |
| --- | ---: | ---: | ---: | ---: | ---: |
| rookie | 463 | 6 | 63.833 | 64.0057 | 0.1726 |
| years-1-3 | 1284 | 108 | 51.037 | 49.8991 | -1.1378 |
| years-4-7 | 1130 | 162 | 53.6976 | 52.9093 | -0.7883 |
| years-8-plus | 460 | 99 | 62.2649 | 61.664 | -0.6009 |

### ExpectedRole

| Bucket | N | Contract years | Baseline MAE | Contract MAE | Delta |
| --- | ---: | ---: | ---: | ---: | ---: |
| high | 698 | 72 | 72.7403 | 71.7575 | -0.9828 |
| low | 984 | 137 | 38.5607 | 37.8827 | -0.6781 |
| medium | 1192 | 160 | 55.4825 | 54.4129 | -1.0696 |
| rookie-unknown | 463 | 6 | 63.833 | 64.0057 | 0.1726 |

## Limitations

- The nflverse contract source provides signing year, not an exact transaction date, so all same-year contracts are conservatively excluded.
- Historical contract corrections made after the fact may still exist in the current source snapshot.
- nflverse does not expose consistent historical fantasy draft-date roster snapshots. Season roster records define the evaluation population, while every model feature remains limited to information from prior seasons.
- Starter points and regret use a 10-team league-wide starter pool (1 QB, 2 RB, 2 WR, 1 TE, 2 FLEX per team), not a pick-by-pick room simulation.
- The backtest does not prove a motivational contract-year effect; it only tests incremental out-of-sample prediction.
