# 01: Make Draft Readiness truthful and actionable

**What to build:** Give the manager one consistent readiness result before live drafting: invalid Core Draft Data blocks Recommendations with an exact diagnosis and corrective action, while unavailable Optional Signals remain clearly labeled without taking the Draft Workspace offline.

**Blocked by:** None (can start immediately).

**Status:** completed

- [x] Trusted rankings, canonical player identities, Primary League settings, and confirmed keeper supply are classified as Core Draft Data everywhere readiness is evaluated.
- [x] Each missing, invalid, or stale Core Draft Data category blocks live Recommendations and names the corrective action that restores readiness.
- [x] Experimental predictions, contract context, and sportsbook context degrade independently and never block an otherwise valid core Recommendation.
- [x] Freshness failures accurately state which artifact is older or newer than its dependency and which input must be refreshed.
- [x] Timestamps and source labels use consistent terminology in the Draft Workspace, command output, and generated readiness reporting.
- [x] Readiness reporting distinguishes product-blocking failures, actionable warnings, and Optional Signal degradation from build, type-check, lint, and test results.
- [x] Deterministic readiness scenarios cover every Core Draft Data category and every Optional Signal without relying on wall-clock timing.

## Comments

- Implementation: added one shared Draft Readiness contract for the four Core Draft Data categories and three Optional Signals. The Draft Workspace, `pnpm draft:readiness`, and `data/draft-readiness-report.json` now use the same labels, timestamps, freshness limits, diagnoses, and corrective actions. Live decision output is suppressed when core data is blocked; optional prediction, contract, and sportsbook inputs are independently disabled and labeled without removing the core Recommendation.
- Reporting: the readiness command writes separate collections for product-blocking failures, actionable warnings, Optional Signal degradation, and explicitly not-run engineering checks. Dependency failures state both timestamp directions (the dependent artifact is older and the dependency is newer) and identify the artifact to refresh.
- Verification: `pnpm verify` passed type-check, lint, 318 tests, and all production builds; the subsequent four-scenario Draft Workspace readiness suite also passed after adding the live-only Recommendation gate assertion. The deterministic readiness coverage uses injected clocks. Browser verification at 1280×800 and 390×844 confirmed the blocker/optional sections, actionable controls, dark appearance, and zero page-level horizontal overflow.
- Decision: readiness freshness limits are centralized at 24 hours for rankings, identities, and confirmed league settings; 72 hours for keeper supply; seven days for experimental predictions and contract context; and 48 hours for sportsbook context. Canonical identities require at least 98% ranked-player coverage and all 32 defenses. The versioned Primary League profile intentionally leaves `confirmedAt` null until it is checked against the live provider.
- Current data outcome: implementation completion does not claim that the live draft is presently ready. The readiness command correctly exits nonzero because canonical identity coverage is 97.54%, Primary League settings are not yet provider-confirmed, and keeper confirmation is stale; experimental predictions, contract context, and sportsbook context are reported separately as non-blocking degradation.
