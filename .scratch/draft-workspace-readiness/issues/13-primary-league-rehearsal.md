# 13: Pass the full Primary League rehearsal and freeze features

**What to build:** Prove Draft Readiness with a complete 14-round Primary League rehearsal that starts from keepers, survives an outage, reconciles restored Provider Truth, and produces coherent Recommendations through draft completion.

**Blocked by:** 07: Explain Decision Divergence from the factors that caused it; 08: Keep the experimental model in Shadow Recommendation; 12: Visibly reconcile conflicts against Provider Truth.

**Status:** in-progress

- [ ] The rehearsal uses the provider-confirmed 10-team, 14-round Primary League configuration, including full PPR, tight-end premium, rushing-attempt scoring, configured roster limits, and confirmed keeper supply.
- [ ] Every observed pick is recorded from keepers through the final round, and Recommendations remain coherent after every state transition and while the manager waits between selections.
- [ ] The rehearsal forces a mid-draft synchronization outage, records and corrects Provisional Picks, then restores connectivity.
- [ ] Reconciliation exercises a matching provisional entry, a conflicting entry, and a local entry absent from Provider Truth with visible outcomes.
- [ ] The completed state contains zero missed picks, zero duplicate picks, correct final rosters, and the correct remaining available-player pool.
- [x] The result separately records build, type-check, lint, unit, integration, data-quality, and product-rehearsal outcomes.
- [x] The rehearsal report distinguishes product-blocking failures from warnings and Optional Signal degradation.
- [x] The exact Primary League draft identifier and operational timing are recorded before the real-provider rehearsal without making them prerequisites for deterministic implementation testing.
- [ ] Once the complete rehearsal passes, the release enters feature freeze and permits only data refreshes, rehearsal fixes, and defects that threaten Draft Readiness.

## Comments

- Sleeper Provider Truth was checked on 2026-08-25. The draft has 10 teams, 14 rounds, 140 total slots, a 60-second pick timer, and a scheduled start at 2026-09-05T18:00:40.000Z. The earlier 15-round acceptance text was stale.
- The same check moved Rico Dowdle's keeper cost from round 10 to the provider-confirmed round 14 slot.
- `pnpm draft:rehearsal` now runs a deterministic 140-slot scenario through 132 state transitions. It checks Recommendations 128 times, including 115 checks while the manager waits, and verifies the confirmed, delayed, Manual Continuity, reconciling, restored, and complete synchronization states.
- The deterministic result has 140 canonical picks, zero missed slots, zero duplicate slots or players, zero roster mismatches, and the correct remaining pool. Reconciliation visibly reports one confirmation, one correction, and one removal.
- `pnpm draft:release-gate` records all seven evidence categories. Build, type-check, lint, unit, integration, data quality, and the deterministic product rehearsal pass. Draft Readiness has no Core Draft Data blockers. Stale experimental predictions and sportsbook context remain non-blocking Optional Signal degradation.
- The gate remains blocked only on the scheduled real-provider rehearsal. Feature freeze is pending and will activate only after that result is recorded as passed.
