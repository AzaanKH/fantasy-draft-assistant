# 09: Continue drafting with Provisional Picks after sync loss

**What to build:** Keep the Draft Workspace useful during a Sleeper outage by entering Manual Continuity and letting the manager record any team's observed selection as a clearly identified Provisional Pick.

**Blocked by:** 03: Initialize canonical draft state from confirmed keepers.

**Status:** completed

- [x] The Draft Workspace visibly distinguishes confirmed, delayed, disconnected, Manual Continuity, and reconciling synchronization states.
- [x] A synchronization failure immediately offers Manual Continuity without discarding the last confirmed Provider Truth.
- [x] The manager can record an observed player, team, and draft position for any team while disconnected.
- [x] Every manual entry is visibly identified as a Provisional Pick and cannot be confused with Provider Truth.
- [x] A Provisional Pick immediately updates the canonical local sequence, team rosters, player availability, current pick, team needs, Return Probability context, Best Pick, and Best Player.
- [x] Recording a Provisional Pick never submits or queues a selection with Sleeper.
- [x] An integration scenario demonstrates continued coherent Recommendations after connectivity is lost and a provisional selection is entered.

## Comments

- Added explicit confirmed, delayed, disconnected, reconciling, complete, and Manual Continuity presentation states. A failed or stale sync offers Manual Continuity only after Provider Truth has been established, and the last confirmed snapshot remains visible.
- Manual Continuity records an available player into any open snake-draft slot. The slot determines the team, preventing a player, team, and draft-position combination that conflicts with the canonical sequence.
- Provisional Picks use a distinct local source, amber board treatment, and exact `Provisional Pick` label. The interface states that these entries are local only and are never submitted or queued with Sleeper.
- Recording a Provisional Pick rebuilds the canonical pick sequence and every team roster, removes the player from availability, advances to the first open pick, and invalidates cached recommendation survival data. Team needs, Return Probability, Best Pick, and Best Player then recalculate from the new state.
- Added store coverage for successful and rejected provisional entries, synchronization-state coverage, and an integration scenario that loses connectivity, records a Provisional Pick, confirms no network request occurs, and verifies coherent downstream recommendations.
- Verified zero-warning lint, TypeScript compilation, and all 244 web-app tests. Live browser verification simulated a Sleeper outage and confirmed the delayed-to-manual flow, local roster and recommendation updates, visible Provisional Pick treatment, and usable contrast in dark and light themes.
