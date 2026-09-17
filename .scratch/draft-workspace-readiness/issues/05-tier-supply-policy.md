# 05: Add tier supply to the Decision Policy

**What to build:** Let Best Pick recognize a meaningful loss of player supply at a tier boundary, without allowing the tier signal to redefine underlying player quality or escape the Conservative Override.

**Blocked by:** 04: Apply Primary League scoring and roster feasibility to Best Pick.

**Status:** completed

- [x] The Decision Policy distinguishes meaningful tier drop-offs from ordinary differences within an interchangeable group.
- [x] Remaining players in the current tier and the value of the next tier affect the cost of waiting shown for a candidate.
- [x] The tier-supply adjustment is explicitly bounded and cannot change Best Player or independently reorder the unrestricted player pool.
- [x] A tier-driven Best Pick remains inside the Conservative Override unless the established roster-feasibility exception applies.
- [x] The Draft Workspace exposes the tier-supply factor when it materially changes the Best Pick ordering.
- [x] Deterministic scenarios verify a meaningful tier cliff, a non-meaningful tier change, and stable tie-breaking.

## Comments

- Added a tier-supply cost of waiting that uses the live count in a position tier and the projected drop to the next available tier. Ordinary gaps score zero.
- Capped tier supply at four policy points. The normal ECR neighborhood and same-position tier boundary still select eligible Best Pick candidates, with legal-roster feasibility as the only exception.
- Kept Best Player in untouched ECR order and recorded whether removing tier supply would change the preferred Best Pick.
- Added the tier factor, cap, live remaining count, next-tier drop, and cost of waiting to recommendation output. The Draft Workspace highlights the factor when it changes Best Pick, and the Assistant uses the same explanation.
- Added deterministic coverage for a meaningful cliff, a small tier gap, shrinking urgency with multiple players left, the four-point bound, Conservative Override enforcement, live cliffs after a drafted boundary player, and ECR, name, and ID tie-breaking.
- Verified all workspace typechecks and lint rules, all 359 tests, the production web build, and the Draft Workspace and Assistant in the shared browser preview at 1280 by 800 in dark and light themes.
