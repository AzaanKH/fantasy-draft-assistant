# 03: Initialize canonical draft state from confirmed keepers

**What to build:** Start preparation, mock rehearsal, and live drafting from one deterministic keeper-aware draft state so every confirmed keeper occupies the correct roster and round exactly once and cannot be recommended as available.

**Blocked by:** 01: Make Draft Readiness truthful and actionable; 02: Deliver the ECR-anchored Decision Lens path.

**Status:** completed

- [x] Unconfirmed, invalid, stale, or unresolved Primary League keeper supply blocks live Recommendations with an actionable readiness diagnosis.
- [x] Confirmed keepers are initialized deterministically at their configured teams and round-selection costs before ordinary draft picks are applied.
- [x] Each keeper is represented exactly once in the canonical draft sequence and on the correct roster.
- [x] Kept players are unavailable under both Decision Lenses before the draft begins.
- [x] A provider snapshot containing reserved keeper selections cannot import those players again as ordinary live picks.
- [x] Resetting or changing between preparation, mock, and live modes preserves the confirmed keeper baseline without duplicating roster assignments.
- [x] End-to-end scenarios verify the Primary League keeper fixture through availability, rosters, draft position, and both decision outputs.

## Comments

- Implementation: added `web-app/src/lib/keeper-supply.ts`, a pure canonicalization step that validates resolved keeper entries into one deterministic sequence — snake-draft pick numbers from team plus round cost, first-occurrence dedupe per kept player, deterministic conflict resolution for same-slot entries, and out-of-range rejection. `draftStore.preloadKeepers` now initializes from the canonical supply so reservations, drafted-player set, and my-roster assignment derive from validated assignments only.
- Exactly-once guards: `consumeKeeperAtCurrentPick` no longer represents a keeper whose player already appears in the canonical sequence (for example when a provider snapshot delivered that player at a different slot); `markPlayerDrafted` continues to reject reserved keepers imported as ordinary picks.
- Readiness: `useKeeperPreload` now reports duplicate keeper entries (`duplicateNames`), and `evaluateWorkspaceDraftReadiness` classifies duplicates as invalid Core Draft Data with an actionable diagnosis naming the duplicated players and the corrective action.
- Readiness hardening: preparation, mock, live, side-panel, and shadow recommendation paths now wait for the complete canonical keeper supply. Partial, duplicate, unresolved, wrong-season, or illegal-slot supply clears the baseline and keeps recommendations off. `isMockReady` uses the same completeness rule.
- Sync normalization: provider picks matching a kept player or a reserved keeper slot are removed before draft history is rebuilt. The cursor advances across keeper slots even when sync arrives before preload, and roster insertion is idempotent.
- Verification: unit coverage includes canonicalization (snake slots, dedupe, conflicts, bounds), incomplete mock readiness, repeated preloads, duplicate/conflict rejection, sync-delivered keepers, the sync-before-preload race, provider snapshots containing reserved keepers, reset/mode transitions, and recommendation gating. An end-to-end suite drives the actual Primary League ten-keeper fixture through availability, rosters, cursor advancement, and both Best Pick and Best Player outputs. `pnpm --filter web-app typecheck`, `pnpm --filter web-app lint`, and all 211 web-app tests pass. Browser verification confirms the readiness blocker in the full draft room and side panel while leaving the roster accessible.
- Note: this issue makes the app consume keeper supply correctly; it does not refresh the underlying data. The readiness blockers shown in the Draft Workspace (identity map invalid, Primary League settings unconfirmed, keeper file stale) remain operational data tasks until their corrective actions run.
