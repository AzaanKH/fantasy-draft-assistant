# Fantasy Draft Assistant

This context defines the language for a draft-season decision product that helps a fantasy manager choose among available players during preparation, mock drafts, and live drafts.

## Language

**Fantasy Draft Assistant**:
The complete product that supports draft preparation, mock rehearsal, and live draft decisions. It ends at draft completion and does not manage the fantasy season afterward.
_Avoid_: Year-round fantasy manager, lineup manager

**Primary League**:
The private 10-team keeper league whose scoring rules, keeper supply, draft history, and live Sleeper draft define the current acceptance criteria.
_Avoid_: Default league, example league

**Draft Workspace**:
The primary full-screen decision surface where the manager sees draft state, recommendations, available players, and roster context together while the provider draft room remains open separately.
_Avoid_: Website, dashboard

**Draft Companion**:
The narrow in-provider surface that carries the same draft state and recommendations as the Draft Workspace. It advises the manager but does not submit provider picks.
_Avoid_: Separate recommendation app

**Public Distribution**:
An open-source, self-hosted form of the Fantasy Draft Assistant in which each manager operates a private instance with their own league access and permitted data credentials.
_Avoid_: Hosted service, shared public data feed

**Best Pick**:
The available player whose selection best improves the expected completed roster across the current and future picks, given the league, roster, tier supply, and draft timing. It can differ from the Best Player.
_Avoid_: Highest-ranked available player

**Best Player**:
The highest-quality available player according to the trusted player-quality ranking, without considering the manager's roster or whether the player could be selected later.
_Avoid_: Best Pick

**Decision Lens**:
The manager-selected perspective used to order available players. The canonical lenses are Best Pick and Best Player, and both remain available throughout the draft.
_Avoid_: Sort order

**Decision Divergence**:
The state in which Best Pick and Best Player identify different players. Both candidates remain visible, with the timing or roster trade-off stated explicitly.
_Avoid_: Ranking error

**Decision Policy**:
The transparent, ECR-anchored rules that produce Best Pick by applying bounded league value, roster construction, tier, and draft-timing adjustments. It is distinct from the experimental prediction model.
_Avoid_: Prediction model, opaque score

**Conservative Override**:
A Best Pick departure from the ECR Anchor that remains within the same player tier or a validated nearby ranking neighborhood, except when a legal completed roster would otherwise be at risk.
_Avoid_: Reach, unrestricted reorder

**Next-Pick Horizon**:
The live optimization boundary covering the current selection and the manager's next selection. It does not simulate the entire remaining draft.
_Avoid_: Full-draft simulation

**Recommendation**:
An explainable ranking of available players for the current draft decision, grounded in trusted player quality, league-adjusted value, roster fit, tier context, and draft timing.
_Avoid_: Prediction, automatic pick

**ECR Anchor**:
The expert-consensus player-quality baseline used by live recommendations while experimental models remain unproven.
_Avoid_: Proven prediction model

**Shadow Recommendation**:
An experimental recommendation recorded for later evaluation but never allowed to control the live recommendation shown to the manager.
_Avoid_: Alternate live recommendation

**Manual Continuity**:
The fallback draft state in which the manager records picks while live provider synchronization is unavailable so recommendations can remain current.
_Avoid_: Mock draft

**Provisional Pick**:
A pick entered during Manual Continuity that keeps the local draft usable but remains subject to confirmation or correction when provider synchronization returns.
_Avoid_: Confirmed pick

**Provider Truth**:
The official Sleeper draft metadata and pick history that ultimately determine the canonical live draft state.
_Avoid_: Local draft state

**Reconciliation**:
The process of comparing Provisional Picks with restored Provider Truth, confirming matches and visibly correcting conflicts without duplicating picks or silently corrupting the roster.
_Avoid_: Reset, resync

**Draft Timing**:
The cost or benefit of selecting a player now instead of waiting for a later pick, including the chance the player remains available and the value of likely alternatives.
_Avoid_: Player quality

**Return Probability**:
The estimated chance that a player remains available at the manager's next selection, based primarily on the league's draft history calibrated by the current consensus market.
_Avoid_: Guarantee, Sleeper rank

**Expected Next-Pick Alternative**:
The same-position fallback with the highest probability-weighted league value at the manager's next selection. It explains the cost of waiting inside the Next-Pick Horizon and does not predict the rest of the draft.
_Avoid_: Guaranteed fallback, full-draft outcome

**Core Draft Data**:
The rankings, player identities, league settings, and confirmed keeper supply required to produce a trustworthy live recommendation.
_Avoid_: Optional signal

**Optional Signal**:
Supplemental model, contract, or sportsbook context that may degrade with an explicit label without blocking the live draft.
_Avoid_: Core Draft Data

**Draft Readiness**:
The state reached when a complete rehearsal verifies the league and keeper configuration, records every pick exactly once, survives a synchronization outage, reconciles successfully, and continues to produce coherent recommendations.
_Avoid_: Successful build, green unit tests
