# Recommendation Backtest

Generated: 2026-05-30T05:56:11.233Z

This is the first transparent replay baseline. It is deliberately limited and
does not claim that the live recommendation scorer is fully validated.

## Coverage

- Evaluated user picks: 49
- Historical non-keeper user picks: 53

## Strategy Comparison

| Strategy | Picks | VOR captured | Average regret | Top-24 position hit rate |
| --- | ---: | ---: | ---: | ---: |
| Actual user draft | 49 | 1005.04 | 122.55 | 0.63 |
| ECR only | 49 | 1477.6 | 112.91 | 0.63 |
| Transparent model V1 | 49 | 863.66 | 125.44 | 0.57 |

## Limitations

- This is a transparent baseline, not a final claim that the live scorer wins.
- The replay excludes players already drafted in the real room and previously selected by each simulated strategy.
- The transparent model uses pre-draft ECR plus trailing production, expected points, and prior-usage scoring adjustments.
- Roster construction, keeper-aware tier removal, injuries known on the historical draft date, and manager-specific behavior are not replayed yet.
