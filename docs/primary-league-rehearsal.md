# Primary League rehearsal

The release gate has two parts. The deterministic rehearsal proves the draft-state and recommendation workflow without a live provider. The real-provider rehearsal confirms the same workflow against the scheduled Sleeper draft.

## Recorded operation

The operational source is `data/primary-league-rehearsal.json`. It records the exact draft and league IDs, scheduled start, time zone, pick timer, provider status, scoring rules, roster limits, and real-provider rehearsal status.

Sleeper Provider Truth currently defines a 10-team, 14-round draft with 140 slots. The roster has one quarterback, two running backs, two wide receivers, one tight end, two flex spots, one kicker, and five bench spots. It has no defense slot. The scoring profile uses full PPR, a 0.5-point tight-end reception premium, and 0.2 points per rushing attempt.

The deterministic scenario does not read the live draft ID or schedule. Run it at any time:

```bash
pnpm draft:rehearsal
```

It writes `data/primary-league-deterministic-rehearsal-report.json`. The scenario preloads all 10 keepers, processes all 130 ordinary picks, checks Recommendations after every state transition, forces a synchronization outage, records three Provisional Picks, and restores Provider Truth. Reconciliation must visibly confirm one match, correct one conflict, and remove one extra local pick.

## Release gate

Run the complete evidence gate with:

```bash
pnpm draft:release-gate
```

The command runs and records these outcomes separately:

- build;
- type-check;
- lint;
- unit tests;
- integration tests;
- data quality and Draft Readiness;
- product rehearsal.

The result is written to `data/primary-league-release-gate-report.json`. A failed engineering check is a release blocker. Invalid Core Draft Data or a failed rehearsal is a product blocker. Warnings and Optional Signal degradation remain separate and do not masquerade as a successful product rehearsal.

## Real-provider rehearsal

Before the scheduled rehearsal:

1. Run `pnpm dev:live`.
2. Connect the draft ID recorded in `data/primary-league-rehearsal.json` and confirm the manager's draft position.
3. Confirm the scoring profile, roster limits, 14 rounds, and all 10 keeper slots against Sleeper.
4. Record each provider pick through draft completion.
5. Force a mid-draft disconnect. Enter one matching Provisional Pick, one conflicting Provisional Pick, and one extra local pick.
6. Restore synchronization and confirm that the reconciliation summary shows one confirmation, one correction, and one removal.
7. Confirm 140 canonical slots, no missed or duplicate picks, 14 players on every roster, and the expected remaining player pool.
8. Set `realProviderRehearsal.status` to `passed` and record `completedAt` only after reviewing the final state.
9. Run `pnpm draft:release-gate` again.

## Feature freeze

The release gate activates feature freeze only after every recorded outcome and the real-provider rehearsal pass. During feature freeze, permitted changes are limited to data refreshes, rehearsal fixes, and defects that threaten Draft Readiness. Any other feature work waits until the draft release is complete.
