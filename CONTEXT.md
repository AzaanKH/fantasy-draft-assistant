# Fantasy Draft Assistant

Use this glossary when naming features or changing behavior in draft preparation, mock drafts, and live drafts. The product ends at draft completion; it does not manage lineups or the fantasy season afterward.

## Language

**Primary League**:
The private 10-team keeper league whose scoring rules, keeper supply, draft history, and live Sleeper draft define the current acceptance criteria.
_Avoid_: Default league, example league

**Primary League Practice Settings**:
The Primary League scoring rules and roster requirements explicitly selected for a Sleeper mock. Sleeper still supplies picks, team count, rounds, and draft order; these practice rules do not claim provider confirmation.
_Avoid_: Provider-confirmed mock settings

**Draft Workspace**:
The main draft view, with draft state, recommendations, available players, and roster context shown together. The provider draft room stays open separately.
_Avoid_: Website, dashboard

**Draft Companion**:
The compact view used beside the provider draft room, with the same draft state and recommendations as the Draft Workspace. It advises the manager without submitting provider picks.
_Avoid_: Separate recommendation app

**Best Pick**:
The available player preferred by the Decision Policy for improving the expected completed roster, given league value, roster needs, Depth Value, tier supply, and the Next-Pick Horizon. It can differ from Best Player.
_Avoid_: Highest-ranked available player

**Best Player**:
The highest-quality available player according to the trusted player-quality ranking, without considering the manager's roster or whether the player could be selected later.
_Avoid_: Best Pick

**Decision Lens**:
The manager-selected perspective used to order available players. The canonical lenses are Best Pick and Best Player, and both remain available throughout the draft.
_Avoid_: Sort order

**Decision Divergence**:
The state in which Best Pick and Best Player identify different players. Both candidates remain visible, with the league-value, roster-fit, depth-value, tier-supply, or timing reason stated explicitly.
_Avoid_: Ranking error

**Decision Policy**:
The transparent, ECR-anchored rules that produce Best Pick by applying bounded league value, roster construction, Depth Value, tier, and draft-timing adjustments. It is distinct from the experimental prediction model.
_Avoid_: Prediction model, opaque score

**Conservative Override**:
A Best Pick departure from the ECR Anchor that remains within the same player tier or a validated nearby ranking neighborhood, except when a legal completed roster would otherwise be at risk.
_Avoid_: Reach, unrestricted reorder

**Next-Pick Horizon**:
The live optimization boundary covering the current selection and the manager's next selection. It does not simulate the entire remaining draft.
_Avoid_: Full-draft simulation

**Recommendation**:
An explainable ranking of available players for the current draft decision, grounded in trusted player quality, league-adjusted value, roster fit, Depth Value, tier context, and draft timing.
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
The connected provider's official draft metadata and pick history that determine the canonical live draft state. Sleeper supplies Provider Truth for the Primary League.
_Avoid_: Local draft state

**Reconciliation**:
The comparison of local picks with restored Provider Truth that confirms matches, corrects conflicts, and removes local picks absent from the official history. Corrections are visible and preserve consistent rosters and player availability.
_Avoid_: Reset, resync

**Draft Timing**:
The cost or benefit of selecting a player now instead of waiting for a later pick, including the chance the player remains available and the value of likely alternatives.
_Avoid_: Player quality

**Depth Value**:
The additional protection a candidate gives the manager's completed roster when a usual starter is unavailable. It rewards useful reserves at thin positions and declines when the roster already has comparable coverage.
_Avoid_: Raw bench points, fixed position quota

**Return Probability**:
The estimated chance that a player remains available at the manager's next selection, based primarily on the league's draft history calibrated by the current consensus market.
_Avoid_: Guarantee, Sleeper rank

**Expected Next-Pick Alternative**:
The same-position fallback with the highest probability-weighted league value at the manager's next selection. It explains the cost of waiting inside the Next-Pick Horizon and does not predict the rest of the draft.
_Avoid_: Guaranteed fallback, full-draft outcome

**Core Draft Data**:
The trusted rankings, canonical player identities, league settings, and complete confirmed keeper supply required for a trustworthy live recommendation. Rankings and identities must be fresh; settings and keepers must be confirmed for the applicable season and league.
_Avoid_: Optional signal

**Optional Signal**:
Supplemental model, contract, or sportsbook evidence that may be unavailable or stale without blocking the live draft. Experimental predictions belong to Shadow Recommendations; contract and sportsbook context remain informational in the current Decision Policy.
_Avoid_: Core Draft Data

**Draft Readiness**:
The state reached when a complete rehearsal verifies the league and keeper configuration, records every pick exactly once, survives a synchronization outage, reconciles successfully, and continues to produce coherent recommendations.
_Avoid_: Successful build, green unit tests
