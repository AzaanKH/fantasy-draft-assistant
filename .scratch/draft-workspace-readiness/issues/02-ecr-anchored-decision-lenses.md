# 02: Deliver the ECR-anchored Decision Lens path

**What to build:** Make the Draft Workspace a complete, read-only decision surface that always presents Best Pick and Best Player, defaults to Best Pick, and lets the manager change Decision Lens without losing the current draft, roster, or player-pool context.

**Blocked by:** None (can start immediately).

**Status:** completed

- [x] The Draft Workspace explains that it optimizes the completed roster and supports preparation, mock rehearsal, and the live Primary League draft through the same decision surface.
- [x] One shared decision output always exposes Best Pick, Best Player, the selected Decision Lens, and whether Decision Divergence exists.
- [x] Best Player is exactly the highest-ranked available player under the trusted ECR Anchor, without roster need, Return Probability, Draft Timing, or experimental-model influence.
- [x] Best Pick is the default Decision Lens, Best Player remains visible, and switching lenses preserves the current pick, roster, availability, filters, and connected draft context.
- [x] Confirmed drafted players are removed from both Decision Lenses, and Recommendations refresh after every confirmed pick while remaining available between the manager's turns.
- [x] The Draft Workspace advises only; no control submits, queues, or confirms a pick in Sleeper.
- [x] A deterministic Draft Workspace integration scenario exercises the decision output through the real draft state, Recommendation calculation, and rendered decision interface.

## Comments

- Implementation: Added shared `DecisionLens`/`DecisionOutput` contracts and one `DraftDecisionProvider` output containing Best Pick, Best Player, the selected lens, the selected answer, and Decision Divergence. Added the always-visible Decision Lens control to the recommendation rail and made the player pool, Assistant, and companion consumers follow the selected shared view without replacing draft, roster, availability, filter, or sync state.
- ECR decision: Best Player now sorts the complete available-player input strictly by ascending trusted ECR, with deterministic name/ID tie-breaking. Roster limits, position needs, Return Probability, Draft Timing, market/model values, and special-teams deferral do not reorder it; those diagnostics may still be displayed for comparison. Confirmed picks and reserved keepers are filtered before both lens calculations.
- Read-only decision: Connected live drafts cannot invoke local draft mutation; local pick actions are limited to mock rehearsal. The rail explicitly says Sleeper submission, queueing, and confirmation remain in Sleeper, while local shortlisting stays separate.
- Verification: `pnpm --filter @fantasy-draft/shared build`, `pnpm --filter web-app typecheck`, `pnpm --filter web-app lint`, `pnpm --filter web-app test` (32 files, 190 tests), and `pnpm --filter web-app build` pass. The deterministic integration test runs a confirmed synced pick through the real draft store, availability filtering, Recommendation calculation, shared decision output, and server-rendered lens interface.
- Browser verification: Exercised the full Draft Workspace at 1280×800 and the lens control at 375×800. Best Pick was the initial active lens; switching to Best Player kept both answers visible, retained pick `1.01`, the WR filter, and the `CeeDee` search, preserved focus, reordered the pool through the selected lens, exposed no provider action in the rail, and produced no horizontal overflow.
