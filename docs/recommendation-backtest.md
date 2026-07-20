# Recommendation Backtest

Generated: 2026-07-20T22:21:24.330Z

This replay is roster-aware and walk-forward. It is allowed to fail its ECR
release gate; a failed gate means the model remains experimental.

## Release Gate

- Passed: **false**
- Decision: Model does not clear the ECR comparison gate; keep it experimental and do not claim an edge.
- Seasons won: 2 / 4 (required 3)

## Aggregate Strategy Comparison

| Strategy | Picks | VOR captured | Starter points | Average regret | Top-24 hit rate |
| --- | ---: | ---: | ---: | ---: | ---: |
| Actual user draft | 49 | 1005.04 | 8316.06 | 113.34 | 0.63 |
| Roster-aware ECR | 49 | 1933.94 | 8699.48 | 107.42 | 0.73 |
| Baseline roster-aware model | 49 | 2028.88 | 8840.74 | 94.89 | 0.69 |
| Roster-aware model | 49 | 1979.98 | 8855.04 | 96.53 | 0.67 |

## Snap Share / NGS Ablation

- Starter points delta vs baseline: 14.3
- VOR delta vs baseline: -48.9
- Average regret delta vs baseline: 1.64
- Top-24 hit-rate delta vs baseline: -0.02

## Walk-Forward Folds

| Test season | Prior league seasons | ECR starter points | Baseline model | Expanded model | Winner |
| --- | --- | ---: | ---: | ---: | --- |
| 2022 | none | 2058.5 | 2133.9 | 2178.5 | model |
| 2023 | 2022 | 2328.8 | 2229.44 | 2272.84 | ecr |
| 2024 | 2022, 2023 | 1826.32 | 2167.24 | 2041.84 | model |
| 2025 | 2022, 2023, 2024 | 2485.86 | 2310.16 | 2361.86 | ecr |

## Limitations

- Historical opponent picks are held fixed; the replay does not simulate replacement picks when a strategy takes a player an opponent selected later.
- The model weights are frozen and transparent rather than fitted inside each fold; walk-forward leakage control applies to its input features and evaluation.
- Injuries known on each historical draft date and manager-specific opponent behavior are not yet replayed.
- The sample contains only four seasons and should be treated as a product gate, not statistical proof of superiority.
