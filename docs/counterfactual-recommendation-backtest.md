# Counterfactual Recommendation Backtest

Generated: 2026-08-31T04:10:02.302Z

This companion to the [fixed-board replay](./recommendation-backtest.md) gives
each strategy its own draft room. Results are means with 95% Monte Carlo
intervals across 1000 simulations per season.

Provenance: command `pnpm model:backtest`; model identifier `counterfactual-opponent-room-v1`; ranking identifier `historical-pre-draft-consensus-rank-proxy`; keeper identifier `historical-user-keepers-from-league-history`; historical-input identifier `2022-2025-league-history`.

This report is diagnostic. The fixed-board replay remains the release gate
because the counterfactual result depends on the opponent model.

## Aggregate Strategy Comparison

Starter points and VOR are summed season means across the four 1,000-simulation season runs. Regret is the pick-weighted mean across all evaluated user picks.

| Strategy | Expected starter points | Expected VOR | Expected regret |
| --- | ---: | ---: | ---: |
| Roster-aware ECR | 8221.11 (7458.48–8958.33) | 1375.33 (343.79–2404.13) | 118.68 (99.09–138.4) |
| Roster-aware model | 7861.72 (7271.84–8479.51) | 536.93 (-205.63–1325.89) | 137.32 (122.57–153.5) |

## Season Results

| Season | ECR starter points | Model starter points | ECR VOR | Model VOR | ECR regret | Model regret |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2022 | 2075.4 (1715.95–2413.5) | 1858.66 (1561.41–2215.59) | 559.03 (55.31–1065.64) | 236.75 (-121.01–647.36) | 95.24 (61.84–131.29) | 123.79 (94.16–152.69) |
| 2023 | 1913.04 (1546.52–2239.45) | 1883.1 (1692.32–2125.1) | 150.8 (-318.99–635.64) | 35.83 (-231.81–334.69) | 120.39 (83.76–157.85) | 132.02 (106.16–158.82) |
| 2024 | 2030.69 (1608.63–2404.19) | 2097.89 (1826.76–2329.05) | 178.11 (-361.8–741.55) | 142.38 (-250.67–522.77) | 134.36 (89.59–178.34) | 138.04 (106.9–175.89) |
| 2025 | 2201.97 (1747.68–2609.35) | 2022.07 (1669.85–2394.98) | 487.38 (-82.15–1037.46) | 121.97 (-302.82–596.65) | 126.67 (84.97–170.77) | 156.53 (121.27–192.54) |

## Opponent Model

- Keepers are seeded before the draft and removed from every room's board.
- The user selects with roster-aware ECR or the walk-forward model.
- Opponents sample from available offensive players using the pre-draft market-rank proxy, current roster need, and that owner's prior-season position tendencies.
- Manager tendencies are phase-specific (rounds 1–4, 5–8, and 9+) and shrink toward league rates when samples are small.
- Every selected player is removed only from that strategy's simulated room.
- Random seed: 20260720.

## Limitations

- Historical pre-draft consensus rank is an ADP proxy, not observed historical player-level ADP.
- Opponent behavior is a calibrated heuristic rather than a validated choice model; confidence intervals measure Monte Carlo draft-room variance, not model uncertainty.
- Kicker and defense turns remain allocated at their historical slots, while only the offensive player board is resampled.
- Injuries known on each historical draft date are not explicitly modeled beyond their effect on the pre-draft market rank.
- Only four outer test seasons are available.
