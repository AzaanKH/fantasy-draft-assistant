# 04: Apply Primary League scoring and roster feasibility to Best Pick

**What to build:** Make Best Pick improve the manager's expected completed roster by applying bounded Primary League scoring and roster-construction adjustments while retaining Best Player as the unchanged ECR reference.

**Blocked by:** 03: Initialize canonical draft state from confirmed keepers.

**Status:** completed

- [x] Best Pick accounts for full PPR, the additional tight-end reception premium, rushing-attempt scoring, and the Primary League's replacement context.
- [x] Best Pick accounts for open fixed starters, FLEX eligibility, bench depth, position limits, and the selections remaining to complete a legal roster.
- [x] League-value and roster-fit adjustments have explicit bounds, deterministic tie-breaking, and cannot independently create an unrestricted reorder of the available pool.
- [x] A normal Best Pick departure remains inside the Conservative Override tier or validated nearby ECR neighborhood.
- [x] Roster feasibility can cross the normal boundary only when the bounded candidates would make a legal completed roster impossible.
- [x] The decision output exposes the player-quality, league-value, and roster-fit factors that actually affected the ordering.
- [x] Product-boundary scenarios verify both ordinary bounded choices and the explicit legal-roster feasibility exception.

## Comments

- Added a dedicated Primary League Best Pick policy while leaving Best Player as the unchanged ECR reference.
- Bounded league value to 6 policy points and roster fit to 8 policy points. Normal candidates must remain within eight ECR ranks of the anchor or share its positional tier.
- Modeled fixed starters, FLEX assignments, bench depth, position caps, total roster capacity, and exact selections remaining. The policy can leave the normal boundary only when every bounded candidate would eliminate all legal completion paths.
- Added deterministic tie-breaking by feasibility, policy score, ECR, player name, and player ID.
- Exposed the applied player-quality, league-value, roster-fit, boundary, and feasibility factors in recommendation data and in the Best Pick rail.
- Added product-boundary coverage for PPR, tight-end premium, rushing-attempt scoring, replacement value, FLEX and bench needs, position limits, the conservative ECR boundary, deterministic ties, and the legal-roster exception.
- Verified shared build, web typecheck, lint, all 218 web tests, production build, and the setup preview at desktop and mobile widths in light and dark themes.
