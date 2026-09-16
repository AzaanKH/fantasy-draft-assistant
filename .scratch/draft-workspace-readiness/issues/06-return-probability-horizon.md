# 06: Add Return Probability over the Next-Pick Horizon

**What to build:** Help the manager compare selecting a candidate now with waiting until the next selection by estimating Return Probability from Primary League behavior calibrated to the current market.

**Blocked by:** 04: Apply Primary League scoring and roster feasibility to Best Pick.

**Status:** completed

- [x] Live optimization covers only the current selection and the manager's next selection, not a full remaining-draft simulation.
- [x] Primary League draft history is the dominant evidence for Return Probability.
- [x] Current consensus market evidence calibrates historical behavior, while Sleeper rank remains a secondary timing input and never becomes the player-quality definition.
- [x] The cost of selecting now versus waiting can alter Best Pick within the Conservative Override boundary without changing Best Player.
- [x] Return Probability and the expected next-pick alternative refresh after every confirmed or provisional draft-state change and remain visible while the manager is waiting.
- [x] Recommendation computation remains deterministic, explainable, and fast enough for the live draft clock without a remote model response.
- [x] Scenarios independently verify historical dominance, market calibration, Sleeper's secondary role, and the Next-Pick Horizon boundary.

## Comments

- Version 2 of the local survival model stores the Primary League's empirical pick distribution by position. A candidate's current consensus percentile is mapped into that distribution, then calibrated with explicit evidence weights: Primary League history 70%, current consensus 25%, and Sleeper timing rank 5%.
- Return Probability is conditional on the player still being available at the live cursor and names the manager's exact next selection. The horizon stops after that selection; there is no full-draft forecast.
- Best Pick now includes a bounded Draft Timing factor based on the expected value lost by waiting. The factor is capped at four policy points and remains inside the existing Conservative Override neighborhood. Best Player stays consensus-only.
- The expected next-pick alternative is the same-position fallback with the highest probability-weighted league value. Both it and Return Probability recompute after confirmed and provisional state changes and remain visible in the recommendation rail, Assistant, and side panel.
- Independent scenarios cover historical dominance, current-market calibration, Sleeper's secondary role, cursor reconditioning, the final-pick boundary, timing-driven Best Pick changes, Best Player stability, and fallback refresh.
- Verified with `pnpm verify`: all workspace typechecks and zero-warning lint passed, 370 tests passed, and all production builds completed. Browser checks covered the 1280px draft and Assistant views plus the 375px side panel, including a live probability refresh when the mock draft advanced from pick 1.01 to 1.02.
