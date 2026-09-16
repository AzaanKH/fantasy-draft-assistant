# 11: Confirm matching Provisional Picks on reconnect

**What to build:** Automatically reconcile correct manual observations when Sleeper returns so matching Provisional Picks become confirmed Provider Truth without duplicating picks or disrupting the next Recommendation.

**Blocked by:** 09: Continue drafting with Provisional Picks after sync loss.

**Status:** completed

- [x] Restored Sleeper connectivity automatically enters Reconciliation using the latest complete Provider Truth snapshot.
- [x] A Provisional Pick matching the official player and draft position becomes a confirmed provider pick.
- [x] The confirmed pick is represented exactly once in the canonical sequence, player availability, and team roster.
- [x] The manager receives a visible reconciliation summary identifying the confirmation.
- [x] Derived draft and Recommendation state is rebuilt from the reconciled canonical sequence before the next decision is presented.
- [x] Reprocessing the same snapshot or reconnecting again does not duplicate picks, confirmations, notices, roster assignments, or Recommendation transitions.
- [x] An integration scenario covers a perfect manual match and repeated delivery of the same Provider Truth.

## Comments

- Manual Continuity now records the last successful Sleeper snapshot as its baseline. A newer successful full snapshot moves the workspace into Reconciliation, enables canonical import, and stays reconciling until that exact snapshot has been applied.
- Store reconciliation detects a match by canonical player ID and overall draft position. It replaces the provisional entry with one `sync` entry, then rebuilds history, availability, all team rosters, the manager roster, current pick, and timing inputs in one Zustand update.
- The workspace shows one dismissible reconciliation summary with the confirmed player, position, round.pick, overall pick, and team. Repeated snapshots cannot recreate a dismissed notice because the canonical entry is no longer provisional.
- Confirmed sync entries retain their object and timestamp when an identical snapshot arrives. If history and current pick already match, the store returns without mutation, roster rebuilding, timing invalidation, or a Recommendation transition.
- Integration coverage exercises a perfect match, both Decision Lenses after confirmation, exact roster and availability state, the rendered confirmation summary, and repeated delivery of the same Provider Truth. Store coverage also verifies one state transition for the first confirmation and zero for the repeat.
- Verification passed TypeScript, zero-warning lint, the production web build, and all 251 web tests. Browser checks covered the live draft workspace plus the reconciliation summary at desktop and narrow widths in light and dark modes, including dismissal and console output.
