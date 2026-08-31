# Draft Workspace Decision Quality and Live-Draft Resilience

**Status:** ready-for-agent

## Problem Statement

The Fantasy Draft Assistant needs to help a manager build the strongest completed roster in the Primary League, not merely identify the highest-ranked available player at one moment. The current product has useful ranking, recommendation, draft-state, and synchronization foundations, but it does not yet express the central decision clearly enough: the Best Pick for the manager's roster and draft timing may differ from the Best Player available.

That distinction must remain understandable and trustworthy under a live draft clock. The manager needs to see both candidates, understand a disagreement immediately, switch Decision Lens without losing context, and know that the live Recommendation is anchored to trusted ECR rather than an unproven model. The product must also remain useful when Sleeper synchronization fails. A temporary outage must not force the manager to work from stale recommendations, and recovery must not create duplicate picks or silently overwrite a correction.

Draft Readiness is therefore a product outcome, not simply a green build. The Draft Workspace is ready when the Primary League can be rehearsed from keepers through the final round, every pick is represented exactly once, an outage can be survived through Manual Continuity, restored Provider Truth can be reconciled visibly, and every resulting Recommendation remains coherent. Invalid Core Draft Data must block live use, while an unavailable Optional Signal must never unnecessarily take the Draft Workspace offline.

## Solution

Make the Draft Workspace the dependable decision surface for preparation, mock rehearsal, and the live Primary League draft. Its purpose is:

> Help the manager build the strongest completed roster by continuously showing both the Best Pick for the current draft strategy and the Best Player available, explaining any disagreement, and remaining usable if live synchronization fails.

Best Pick will be the default Decision Lens. It will use a transparent, ECR-anchored Decision Policy that makes bounded adjustments for Primary League scoring, roster construction, tier supply, and Draft Timing across the current selection and the manager's next selection. Best Player will remain the unadjusted trusted player-quality reference. When they differ, the interface will keep both visible, prefer Best Pick, and state the trade-off in one sentence.

The live workflow will treat Sleeper as Provider Truth. During a synchronization outage, the manager can enter Provisional Picks through Manual Continuity and continue receiving Recommendations. On reconnection, Reconciliation will compare those entries with the official Sleeper snapshot, confirm matches, visibly correct conflicts, remove duplicates, and recompute every derived roster and recommendation result.

Draft Readiness will distinguish Core Draft Data from Optional Signals. Rankings, player identities, league settings, and confirmed keeper supply must be valid and fresh enough for live use. Experimental model output, contract context, and sportsbook context may degrade with explicit labels. A complete Primary League rehearsal, including a forced disconnect and reconnect, is the release gate. Once that gate is reached, feature development freezes so remaining time can be spent refreshing data, rehearsing, and correcting defects.

## User Stories

1. As the Primary League manager, I want the Draft Workspace to state its purpose clearly, so that I know it is optimizing my completed roster rather than predicting one isolated pick.
2. As the Primary League manager, I want to use the same Draft Workspace during preparation, mock rehearsal, and the live draft, so that the live workflow is already familiar under time pressure.
3. As the Primary League manager, I want the product to stop at draft completion, so that live-draft reliability is not diluted by unrelated season-management features.
4. As the Primary League manager, I want the Draft Workspace to advise me without submitting a Sleeper pick, so that I retain final control over every selection.
5. As the Primary League manager, I want to keep Sleeper open in a separate browser tab, so that I can use the complete Draft Workspace without depending on an extension surface.
6. As the Primary League manager, I want the current draft state, my roster, available players, and Recommendations together, so that I can make a pick without assembling context from several product pages.
7. As the Primary League manager, I want Best Pick to be the default Decision Lens, so that the first answer I see accounts for roster construction and Draft Timing.
8. As the Primary League manager, I want Best Player to remain visible beside Best Pick, so that I can compare strategy with trusted player quality.
9. As the Primary League manager, I want to switch between Best Pick and Best Player, so that I can inspect the available-player pool from either perspective.
10. As the Primary League manager, I want switching the Decision Lens to preserve my draft and roster context, so that comparison does not interrupt the live workflow.
11. As the Primary League manager, I want Best Player to follow the trusted ECR Anchor, so that its meaning remains stable and independently understandable.
12. As the Primary League manager, I want Best Pick to account for Primary League scoring, so that TE premium and rushing-attempt value affect decisions where they materially change roster value.
13. As the Primary League manager, I want Best Pick to account for open starter, flex, bench, and legal roster needs, so that the Recommendation helps produce a valid completed roster.
14. As the Primary League manager, I want Best Pick to account for player tiers and tier drop-offs, so that a scarce opportunity is distinguished from a group of interchangeable players.
15. As the Primary League manager, I want Best Pick to consider whether a candidate is likely to return at my next pick, so that I can compare selecting the player now with waiting.
16. As the Primary League manager, I want Return Probability to use my league's history as its primary evidence, so that timing reflects how my league actually drafts.
17. As the Primary League manager, I want current consensus market evidence to calibrate Return Probability, so that old league history can adapt to the present player market.
18. As the Primary League manager, I want Sleeper rank to be secondary timing evidence, so that one provider proxy cannot silently define player quality.
19. As the Primary League manager, I want live optimization limited to the current pick and my next pick, so that the Recommendation stays fast, explainable, and appropriate for the draft clock.
20. As the Primary League manager, I want Best Pick departures from ECR to remain conservative, so that the Decision Policy cannot turn small signals into unjustified reaches.
21. As the Primary League manager, I want a Best Pick departure normally limited to the same tier or a validated nearby ranking neighborhood, so that strategic adjustments stay bounded.
22. As the Primary League manager, I want roster feasibility to override the normal conservative boundary when necessary, so that the assistant does not recommend an impossible completed roster.
23. As the Primary League manager, I want the factors behind Best Pick to be visible, so that I can understand the effects of player quality, league value, roster fit, tier supply, and Draft Timing.
24. As the Primary League manager, I want Decision Divergence to show both candidates together, so that a disagreement does not hide either useful answer.
25. As the Primary League manager, I want Decision Divergence to identify Best Pick as the preferred choice, so that the interface still provides a decisive recommendation.
26. As the Primary League manager, I want Decision Divergence explained in one sentence, so that I can understand the essential timing or roster trade-off before the pick timer expires.
27. As the Primary League manager, I want Recommendations to update after every confirmed pick, so that drafted players and changed roster needs are reflected immediately.
28. As the Primary League manager, I want Recommendations to remain available while I am waiting for my turn, so that I can prepare likely choices in advance.
29. As the Primary League manager, I want unavailable players removed from both Decision Lenses, so that neither answer can recommend someone already drafted.
30. As the Primary League manager, I want keeper supply incorporated before the live draft begins, so that kept players do not appear as available and keeper-round effects are represented correctly.
31. As the Primary League manager, I want the experimental model to produce only a Shadow Recommendation, so that it can be evaluated without controlling my live choice.
32. As the Primary League manager, I want the live Recommendation to remain usable when the experimental model is missing or stale, so that optional research cannot block the draft.
33. As the Primary League manager, I want the current synchronization state to be visible, so that I know whether draft state is confirmed, delayed, disconnected, or being reconciled.
34. As the Primary League manager, I want a synchronization failure to offer Manual Continuity immediately, so that the local draft state does not fall behind the real draft.
35. As the Primary League manager, I want to record any team's observed pick during Manual Continuity, so that the available-player pool can remain accurate during a provider outage.
36. As the Primary League manager, I want manually recorded picks identified as Provisional Picks, so that local observation is never confused with Provider Truth.
37. As the Primary League manager, I want a Provisional Pick to update rosters, availability, and Recommendations immediately, so that Manual Continuity is genuinely useful.
38. As the Primary League manager, I want to correct an accidental Provisional Pick before synchronization returns, so that a local input mistake does not compound during the outage.
39. As the Primary League manager, I want restored Sleeper data to initiate Reconciliation automatically, so that I do not need to reset or rebuild the draft manually.
40. As the Primary League manager, I want matching Provisional Picks confirmed during Reconciliation, so that correct manual work is preserved without duplicate picks.
41. As the Primary League manager, I want Provider Truth to replace a conflicting Provisional Pick, so that Sleeper remains the final system of record.
42. As the Primary League manager, I want every reconciliation correction shown visibly, so that the product never silently changes the draft state I was using.
43. As the Primary League manager, I want Reconciliation to remove picks absent from the restored official snapshot, so that a mistaken local observation does not remain drafted.
44. As the Primary League manager, I want each official pick represented exactly once after reconnecting, so that availability and roster totals cannot be corrupted by duplicates.
45. As the Primary League manager, I want all derived roster, availability, timing, and Recommendation state recomputed after Reconciliation, so that the next decision uses the corrected draft.
46. As the Primary League manager, I want invalid or stale trusted rankings to block live Recommendations, so that the Draft Workspace does not present false confidence.
47. As the Primary League manager, I want unresolved player identities to block live Recommendations, so that picks cannot be attached to the wrong players.
48. As the Primary League manager, I want incorrect league settings to block live Recommendations, so that the Decision Policy cannot optimize the wrong scoring format or roster.
49. As the Primary League manager, I want unconfirmed keeper supply to block live Recommendations, so that the available-player pool starts from the correct draft inventory.
50. As the Primary League manager, I want a blocked state to identify the exact Core Draft Data problem and corrective action, so that I can restore Draft Readiness quickly.
51. As the Primary League manager, I want stale experimental predictions labeled and disabled rather than treated as current, so that optional output cannot masquerade as live evidence.
52. As the Primary League manager, I want missing contract or sportsbook context labeled as unavailable, so that I understand why an Optional Signal is absent without losing the core Recommendation.
53. As the Primary League manager, I want freshness failures to describe the actual timestamp relationship correctly, so that readiness diagnostics are actionable rather than contradictory.
54. As the Primary League manager, I want all timestamps and source labels presented consistently, so that I can judge whether the draft inputs are trustworthy.
55. As the Primary League manager, I want a full 15-round Primary League rehearsal with configured keepers, so that the live setup is tested in the form I will actually use.
56. As the Primary League manager, I want the rehearsal to force a synchronization outage, so that Manual Continuity is verified before draft day rather than discovered during it.
57. As the Primary League manager, I want the rehearsal to restore synchronization and exercise both matching and conflicting Provisional Picks, so that Reconciliation covers its meaningful paths.
58. As the Primary League manager, I want the rehearsal to verify zero missed and zero duplicate picks, so that the completed draft state is trustworthy.
59. As the Primary League manager, I want the rehearsal to verify coherent Recommendations throughout the draft, so that correctness is judged continuously rather than only at startup.
60. As the Primary League manager, I want the rehearsal result to identify blocking failures separately from optional degradation, so that remaining work is prioritized by draft risk.
61. As the Primary League manager, I want feature development frozen after Draft Readiness is achieved, so that the final preparation window is spent on data refreshes, rehearsals, and defect correction.
62. As a future self-hosting manager, I want provider credentials to remain local to my own instance, so that eventual Public Distribution does not expose a shared private credential.
63. As a future contributor, I want provider-specific data access behind replaceable boundaries, so that Public Distribution can use permitted sources without rewriting the Decision Policy.
64. As a future contributor, I want the private Sleeper acceptance path completed before public packaging work begins, so that a proven product is extracted instead of designing a hypothetical platform.

## Implementation Decisions

- The immediate release target is Draft Readiness for the private 10-team Sleeper Primary League. Preparation and mock rehearsal exist to validate that target; Public Distribution follows a successful private draft.
- The product boundary ends at draft completion. Lineup management, waivers, trades, and other in-season decisions are excluded from the Fantasy Draft Assistant domain.
- The Draft Workspace is the primary surface. The manager makes the actual selection in Sleeper, normally in a separate tab. The Draft Companion may reuse the same state and decisions, but it is not a Draft Readiness gate.
- The Primary League configuration is the acceptance fixture: 10 teams, full PPR, an additional 0.5 points per tight-end reception, 0.2 points per rushing attempt, keeper supply, and the configured roster limits.
- The decision output contract always exposes Best Pick, Best Player, the selected Decision Lens, and any Decision Divergence. Best Pick is the default; Best Player never disappears merely because another lens is active.
- Best Player is the highest-ranked available player under the trusted ECR Anchor. It does not include roster need, Return Probability, or Draft Timing.
- Best Pick is produced by a transparent Decision Policy, not by the experimental prediction model. The policy starts from the ECR Anchor and applies bounded league-value, roster-construction, tier-supply, and Draft Timing adjustments.
- League-value adjustments use the Primary League's scoring and replacement context. They may change relative positional value but must not independently create an unrestricted reorder of the player pool.
- Roster-construction adjustments account for legal starters, flex eligibility, bench depth, position limits, and the feasibility of a valid completed roster.
- Tier adjustments identify meaningful supply drop-offs. A tier signal influences the cost of waiting; it does not redefine underlying player quality.
- Draft Timing is evaluated over the Next-Pick Horizon: the current selection and the manager's next selection. Full remaining-draft simulation is intentionally excluded from live optimization.
- Return Probability uses the Primary League's own draft history as primary evidence, calibrated by current consensus market evidence. Sleeper rank is a secondary signal rather than the definition of quality.
- A Conservative Override normally keeps Best Pick within the Best Player's tier or a separately validated nearby ECR neighborhood. The only categorical exception is preserving the feasibility of a legal completed roster.
- Decision Policy factors have explicit bounds and deterministic tie-breaking. The displayed explanation must be derivable from the factors that actually changed the order.
- Decision Divergence presents both candidates in the same decision area, marks Best Pick as preferred, and gives one concise explanation of the dominant timing or roster trade-off.
- The experimental model remains a Shadow Recommendation. It may be logged and evaluated against outcomes, but it cannot replace Best Pick or alter the live ordering during this release.
- Draft state has one canonical provider boundary. Sleeper snapshots and events enter through that boundary, while the recommendation domain consumes provider-neutral draft metadata and pick events.
- Provider Truth is authoritative after connectivity returns. Local state must never become a competing permanent source of record.
- Manual Continuity is an explicit synchronization state. It permits the manager to create, correct, and remove Provisional Picks while retaining clear provenance for each pick.
- A Provisional Pick immediately affects player availability, team rosters, current pick position, team needs, Return Probability context, and both Decision Lenses.
- Reconciliation compares Provisional Picks with the latest complete Provider Truth by pick identity and position in the draft. Matching entries become confirmed, conflicting entries are replaced, and locally observed entries absent from the official snapshot are removed.
- Reconciliation is idempotent. Reprocessing the same provider snapshot must not duplicate picks, notices, roster assignments, or recommendation transitions.
- A reconciliation result includes a user-visible summary of confirmations, corrections, removals, and any unresolved identity. All derived state is rebuilt from the reconciled canonical sequence rather than patched incrementally from potentially corrupt state.
- Core Draft Data consists of trusted rankings, canonical player identities, league settings, and confirmed keeper supply. A stale or invalid core input blocks live Recommendations with a specific diagnosis and remediation.
- Experimental model output, contract context, and sportsbook context are Optional Signals. Missing, stale, or failed optional inputs degrade independently with explicit source and freshness labels.
- Freshness checks compare timestamps with consistent direction and terminology. Messages must state whether an artifact is older or newer than its dependency and identify which input requires refresh.
- Readiness reporting separates product-blocking failures, actionable warnings, and optional degradation. A successful build or unit-test run is necessary but is not sufficient evidence of Draft Readiness.
- Keeper initialization is deterministic and part of the canonical draft sequence. A kept player cannot remain in the available pool or be imported again as an ordinary live pick.
- The same decision output and synchronized draft state are shared by the Draft Workspace, Assistant views, and optional Draft Companion; surfaces do not implement independent recommendation logic.
- Recommendation computation remains fast enough to update after each pick and after each Manual Continuity action without requiring a remote model response.
- The implementation sequence is risk-first: correct readiness semantics and current inputs, implement the two Decision Lenses and divergence explanation, implement Manual Continuity and Reconciliation, then run the complete rehearsal.
- Once the complete rehearsal passes, the code enters a feature freeze. Only data refreshes, rehearsal fixes, and defects that threaten Draft Readiness remain eligible before the Primary League draft.
- Public Distribution is a later open-source, self-hosted extraction. Each manager supplies private league access and any permitted provider credentials. No private credential, cached licensed dataset, or shared provider-data service is bundled into the public repository.
- Provider integrations must stay replaceable so a future public build can use permitted sources without changing the core Decision Policy or draft-state model.

## Testing Decisions

- A good test asserts behavior visible at a stable product boundary: the candidate shown, the explanation displayed, the availability and roster state produced, the synchronization status reported, or the reconciliation outcome observed. Tests should not assert component structure, store internals, or incidental numeric intermediates.
- The primary acceptance seam is one Draft Workspace integration harness. It feeds a deterministic Primary League fixture and a controlled Sleeper event stream through the real synchronization, draft state, Decision Policy, and rendered decision interface.
- The primary seam covers the normal live path, Best Pick and Best Player visibility, Decision Lens switching, Decision Divergence, pick-by-pick recommendation changes, loss of connectivity, Manual Continuity, restored Provider Truth, visible Reconciliation, duplicate prevention, and recomputation.
- The acceptance harness uses deterministic player, tier, keeper, league-history, and market fixtures. It controls time so Core Draft Data blocking and Optional Signal degradation can be verified without flaky wall-clock behavior.
- Decision Lens tests assert ordering and explanations, not private weight values. Where a bound is part of the public Decision Policy, tests assert that the resulting choice remains inside the allowed tier or ranking neighborhood.
- Roster-feasibility scenarios verify the explicit Conservative Override exception by constructing drafts in which a normal bounded candidate would make a legal completed roster impossible.
- Return Probability scenarios compare selecting now with waiting until the manager's next pick. They verify that league history dominates, current market evidence calibrates it, and Sleeper rank remains secondary.
- Reconciliation scenarios include a perfect manual match, a conflicting player at the same pick, an extra local pick absent from Provider Truth, a provider correction, an unresolved player identity, repeated delivery of the same snapshot, and reconnecting more than once.
- Data-readiness scenarios independently stale or invalidate each Core Draft Data category and each Optional Signal. Every core scenario blocks with a correct remediation; every optional scenario preserves the core Recommendation and labels the degradation.
- Focused tests remain appropriate for the deterministic Decision Policy, league scoring, roster needs, tier handling, survival/Return Probability, freshness classification, provider normalization, draft synchronization engine, draft stores, and recommendation explanation formatting.
- Existing calculation tests are prior art for ranking and timing edge cases. Existing synchronization-engine, synchronization-hook, and draft-store tests are prior art for provider normalization, corrected snapshots, duplicate prevention, and store transitions.
- The Draft Workspace acceptance harness is the release contract; focused tests exist to cover combinatorial edge cases and localize faults rather than replace that higher seam.
- A manual or automated full 15-round rehearsal uses the actual Primary League configuration and keeper supply. It records every observed pick, forces a mid-draft outage, enters Provisional Picks, restores Sleeper connectivity, and completes Reconciliation.
- The rehearsal passes only with zero missed picks, zero duplicate picks, correct final rosters, a correct available-player pool, successful reconciliation notices, and coherent Recommendations throughout.
- Build, type-check, lint, unit, integration, data-quality, and rehearsal results are recorded separately so a green engineering check cannot conceal a failed product-readiness criterion.

## Out of Scope

- Automatically submitting or queuing picks in Sleeper.
- Post-draft lineup, waiver, trade, matchup, or season-management features.
- Promoting the experimental prediction model from Shadow Recommendation to live control.
- Full-draft Monte Carlo simulation or optimization beyond the Next-Pick Horizon.
- Rebuilding the entire ranking system around Sleeper ADP or any single market source.
- Making the Draft Companion or Chrome extension a blocker for the Primary League draft.
- New ESPN live-draft work for the already completed ESPN league.
- A hosted multi-user service, shared credential service, payment system, or commercial product launch.
- Publishing, redistributing, or bundling provider data whose license does not permit Public Distribution.
- Public installation, authentication, configuration, documentation, or packaging work before the private Sleeper acceptance path succeeds.
- Broad codebase architecture improvements that do not directly reduce risk for the Decision Policy, Manual Continuity, Reconciliation, data readiness, or rehearsal.
- Adding new Optional Signals before Draft Readiness.

## Further Notes

- This specification aligns with the existing decisions that Sleeper remains authoritative after Manual Continuity and that Core Draft Data blocks live use while Optional Signals degrade.
- The exact 2026 Primary League draft date, time, and Sleeper draft identifier were not found in the repository. They are operational inputs for the final rehearsal and live launch, not blockers to implementing this specification.
- The current audited baseline passes the repository verification suite, but the strict data-quality report is not yet green because prediction artifacts trail refreshed inputs. The failure wording also appears directionally confusing and should be corrected as part of readiness semantics.
- The existing worktree contains substantial changes unrelated to this specification. Before implementation begins, preserve an owner-approved checkpoint or otherwise record the baseline without discarding or overwriting those changes.
- Private use of existing data credentials does not grant permission to redistribute credentials or cached provider datasets. Public Distribution must complete a separate source-by-source permission and licensing review.
- After this specification is accepted, `to-tickets` should split it into small tracer-bullet vertical slices with explicit blocking edges. The first implementation frontier should address readiness truthfulness and the minimal end-to-end Decision Lens path before expanding into Manual Continuity and the full rehearsal.
