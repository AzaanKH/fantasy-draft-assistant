# 08: Keep the experimental model in Shadow Recommendation

**What to build:** Allow experimental recommendations to be observed and evaluated without ever controlling the live ordering or making the Draft Workspace unavailable when the experiment is missing, stale, or failing.

**Blocked by:** 01: Make Draft Readiness truthful and actionable; 02: Deliver the ECR-anchored Decision Lens path.

**Status:** completed

- [x] Live Best Pick and Best Player remain ECR-anchored and are identical whether experimental predictions are present, absent, stale, or failing.
- [x] Experimental output is recorded only as a Shadow Recommendation with enough draft and decision context for later evaluation.
- [x] A stale experimental artifact is disabled and labeled with its source and freshness instead of being treated as current evidence.
- [x] Shadow logging failure does not block or delay the core Recommendation shown under the draft clock.
- [x] Missing or stale contract and sportsbook context is labeled as unavailable without changing Core Draft Data readiness.
- [x] Product-boundary scenarios prove that Optional Signal degradation cannot alter live ordering or remove the core Recommendation.

## Comments

- The live player view is now built without experimental predictions, contract context, or sportsbook context. Those inputs cannot change live projections, VOR, tiers, risk, Best Pick, or Best Player.
- A ready prediction artifact builds a separate shadow player view. Missing, invalid, stale, or dependency-stale artifacts build no shadow view, even when stale rows remain present in memory.
- The shadow observer receives the already-computed core Best Pick, Best Player, and core ordering. It runs experimental scoring after the core decision commits, contains scoring errors, and posts telemetry through a non-throwing request path.
- Each event records the provider, draft and pick IDs, league-settings fingerprint, roster, drafted players, position needs, core policy and candidates, experimental source, model version, artifact timestamp, freshness state, and shadow ordering.
- Draft Readiness continues to classify predictions, contracts, and sportsbook data as Optional Signals. The workspace labels unavailable context with the source, timestamp, age or dependency problem, and refresh action while keeping the core recommendation present whenever Core Draft Data is valid.
- Product-boundary tests cover ready, absent, stale, and invalid Optional Signal states. All four produce identical Best Pick and Best Player ordering; only the ready state admits experimental records to Shadow Recommendation.
- `pnpm verify` passed all workspace typechecks, zero-warning lint, 378 tests, and all production builds.
- Browser verification at 1280 by 800 showed the dependency-stale experimental artifact and stale sportsbook source with exact timestamps and corrective actions. The Draft Workspace still displayed the ECR-anchored recommendation rail with no new console errors or horizontal overflow.
