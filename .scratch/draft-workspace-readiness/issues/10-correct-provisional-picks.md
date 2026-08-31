# 10: Correct Provisional Picks during Manual Continuity

**What to build:** Let the manager repair an observed-pick mistake before Sleeper reconnects, without compounding local draft-state errors or altering confirmed Provider Truth.

**Blocked by:** 09: Continue drafting with Provisional Picks after sync loss.

**Status:** completed

- [x] The manager can replace the player or team assigned to a Provisional Pick while Manual Continuity is active.
- [x] The manager can remove an accidental Provisional Pick while Manual Continuity is active.
- [x] Confirmed provider picks cannot be edited or removed through the provisional correction controls.
- [x] Each correction immediately rebuilds affected rosters, availability, current pick, needs, timing, and both Decision Lenses.
- [x] Corrections preserve provisional provenance and leave a visible, understandable local state for later Reconciliation.
- [x] Repeated correction and removal actions cannot create duplicate pick numbers, player assignments, or roster entries.
- [x] Integration scenarios cover replacing and removing a provisional entry before reconnection.

## Comments

- Added guarded store actions that correct or remove only entries whose source is `provisional`. Confirmed picks, keeper slots, occupied pick numbers, and already-assigned players are rejected.
- Every correction rebuilds drafted-player availability, all team rosters, the manager roster, the first open pick, and cached timing inputs from canonical history. The existing needs and recommendation selectors then recompute both Decision Lenses.
- A correction retains its original observation time and provisional source. It also records a local revision count and update time for the Manual Continuity list.
- Manual Continuity now shows every local pick awaiting Reconciliation with Correct and Remove controls. Confirmed picks remain absent from the list and are explicitly labeled as locked.
- Removing a pick uses a confirmation dialog, reopens its draft slot, restores the player to availability, and restores its prior shortlist position when applicable.
- Added adversarial store coverage for confirmed-pick protection, occupied slots, duplicate players, repeat removal, roster cleanup, and shortlist restoration. Added decision integration scenarios for replacement and removal.
- Verified TypeScript, zero-warning lint, the production web build, and all 247 web-app tests. Browser verification covered a live Sleeper snapshot, forced sync loss, correction across player and team, removal, recommendation refresh, and dark and light themes.
