# 12: Visibly reconcile conflicts against Provider Truth

**What to build:** Resolve incorrect or extra local observations transparently when Sleeper returns, ensuring Provider Truth wins and every subsequent roster and Recommendation is computed from the corrected canonical draft.

**Blocked by:** 10: Correct Provisional Picks during Manual Continuity; 11: Confirm matching Provisional Picks on reconnect.

**Status:** completed

- [x] Provider Truth replaces a conflicting Provisional Pick at the same draft position.
- [x] A provisional entry absent from the restored official snapshot is removed from the canonical sequence.
- [x] A provider correction to an earlier confirmed pick replaces the prior value without leaving either player duplicated or incorrectly unavailable.
- [x] An unresolved player identity is never guessed; it is reported visibly and blocks affected live Recommendations with an actionable remediation.
- [x] The reconciliation summary separately reports confirmations, corrections, removals, and unresolved identities without silently changing local state.
- [x] Rosters, availability, current pick, team needs, tier supply, Return Probability, Best Pick, and Best Player are rebuilt from the complete reconciled sequence rather than incrementally patched.
- [x] Reconciliation remains idempotent across conflicting snapshots, repeated snapshots, and more than one disconnect/reconnect cycle.
- [x] Integration scenarios cover a same-pick conflict, an extra local pick, a provider correction, an unresolved identity, and repeated reconnection.

## Comments

- Reconciliation now treats each complete provider snapshot as the canonical ordinary-pick sequence. It classifies matching Provisional Picks as confirmations, same-slot differences as corrections, and prior local or provider picks missing from the snapshot as removals.
- The store rebuilds history, drafted-player availability, every team roster, the manager roster, current pick, shortlist eligibility, and timing inputs in one Zustand update. Identical repeated snapshots preserve the existing history and roster references without another state transition.
- Provider picks must resolve to canonical player data before import. Unresolved identities remain outside canonical history, appear by pick and provider ID in both the reconciliation summary and a persistent blocker, and disable Best Pick, Best Player, tier supply, Return Probability, and Shadow Recommendation logging until repaired.
- The desktop summary presents confirmations, corrections, removals, and unresolved identities in separate labeled groups. The recommendation rail, Assistant, and side panel share the same unresolved-identity block while leaving the board and roster state visible.
- Integration coverage exercises every outcome, a provider revision to an earlier confirmed pick, identity repair, repeated delivery, and a second disconnect/reconnect conflict. All 254 web tests, TypeScript, zero-warning lint, and the production web build pass.
- Browser verification used a deterministic provider snapshot to check the summary and persistent blocker at 1280 px plus the 390 px side panel in light and dark themes. Resolving the identity removed this blocker without hiding the separate Core Draft Data gate. No clipping, overflow, or new console errors appeared.
