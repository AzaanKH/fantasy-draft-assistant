# 07: Explain Decision Divergence from the factors that caused it

**What to build:** When Best Pick and Best Player disagree, keep both answers in one decision area, make the preferred choice unmistakable, and explain the essential roster or Draft Timing trade-off before the pick clock expires.

**Blocked by:** 05: Add tier supply to the Decision Policy; 06: Add Return Probability over the Next-Pick Horizon.

**Status:** completed

- [x] Decision Divergence shows Best Pick and Best Player together without hiding either candidate when the active Decision Lens changes.
- [x] Best Pick is clearly marked as the preferred choice while Best Player retains its independent ECR meaning.
- [x] The divergence explanation is one concise sentence derived from the bounded factors that actually changed the ordering.
- [x] The explanation identifies the dominant league-value, roster-fit, tier-supply, or Draft Timing trade-off rather than reporting an unrelated or generic reason.
- [x] Switching Decision Lens during divergence preserves draft position, roster, availability, filters, and the other candidate.
- [x] Tests assert the candidates, preference, and explanation visible at the product boundary rather than private weights or component structure.

## Comments

- Best Pick now records whether removing league value or roster fit would change its ordering, matching the existing tier-supply and Draft Timing counterfactuals.
- Decision output selects the dominant material factor and supplies one concise sentence that names the preferred candidate, the causal trade-off, and Best Player's independent ECR rank.
- The Decision Lens keeps both candidates in one area. Best Pick retains a compact `Preferred` marker while Best Player shows `Viewing` when its lens is active.
- Product-boundary scenarios cover all four causal explanations and verify that switching lenses preserves the candidates, explanation, pick, roster, availability, filters, and sync state.
- Verified with `pnpm verify`: all workspace typechecks and zero-warning lint passed, 374 tests passed, and all production builds completed. After the compact marker adjustment, the 48 focused tests, web typecheck, lint, and diff checks also passed.
- Browser checks covered both lenses at 1280 by 800 and confirmed that the preference and viewing markers remain clear without overflowing the recommendation rail.
