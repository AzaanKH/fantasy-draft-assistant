# Primary League rehearsal

Use this runbook when verifying a complete draft, changing outage recovery, or
preparing a draft release. For ordinary code changes, use the affected local
tests or `pnpm verify` as described in [AGENTS.md](../AGENTS.md).

The product rehearsal has two parts. A deterministic rehearsal checks the draft-state and recommendation workflow
with fixtures. A real-provider rehearsal checks the connected Sleeper workflow.
The release gate records both forms of evidence; neither substitutes for the
other.

## Outage recovery rules

During a sync outage, Provisional Picks keep the local draft usable without
submitting picks to Sleeper. Once synchronization returns, official Sleeper
history determines the Primary League's canonical state. Confirm matching
picks, correct conflicts, and remove local picks absent from that history so a
mistaken local observation cannot become a second source of truth.

Show the reconciliation result and recompute rosters, player availability, and
Recommendations. Repeated snapshots must not duplicate picks or apply the same
roster change twice. The rehearsals below verify these rules.

Sleeper settings are validated on connection and cached for at most one minute
during polling. A new event-stream client, an explicit snapshot refresh, a
league change, or a polling failure invalidates that cache. Expired settings
must be verified again; a failed refresh does not reuse expired settings.

## Configuration and recorded evidence

| File | Use it for |
| --- | --- |
| [primary-league-settings.json](../data/primary-league-settings.json) | The confirmed season, scoring rules, and roster configuration. |
| [current-keepers.json](../data/league-history/current-keepers.json) | The complete confirmed keeper supply for the current season. |
| [primary-league-rehearsal.json](../data/primary-league-rehearsal.json) | The designated draft and league IDs, schedule, and recorded real-provider outcome. |
| [primary-league-deterministic-rehearsal-report.json](../data/primary-league-deterministic-rehearsal-report.json) | Results from the latest saved deterministic run. |
| [primary-league-release-gate-report.json](../data/primary-league-release-gate-report.json) | Recorded release checks and feature-freeze status. |

The saved 2026 profile has 10 teams, 14 rounds, and 140 slots, including 10
keepers. Each roster has one QB, two RBs, two WRs, one TE, two FLEX spots, one K,
and five bench spots, with no defense slot. Scoring includes full PPR, a
0.5-point tight-end reception premium, and 0.2 points per rushing attempt.
Confirm these values against the connected provider when using this profile.
A saved schedule or report is not a fresh provider observation.

## Deterministic rehearsal

With dependencies installed, run from the repository root:

```bash
pnpm --filter @fantasy-draft/shared build
pnpm draft:rehearsal
```

This uses synthetic players, fixed keeper assignments, and simulated provider
snapshots. It does not launch the browser app, refresh data, or connect to
Sleeper. The command writes only the deterministic rehearsal report under
`data/`, in addition to the shared build output. Running it and rerunning it
after a relevant fix is covered by the local verification permission in
[AGENTS.md](../AGENTS.md).

The scenario processes all 140 slots, including 130 ordinary picks and 10
keepers, and checks Recommendations after state transitions. It forces a sync
outage, records three Provisional Picks, and restores Provider Truth. Expected
results include one confirmation, one correction, one removal, no duplicate or
missing slots, and complete legal rosters.

For changes to the scenario itself, use
[primary-league-rehearsal.ts](../web-app/src/features/draft-room/primary-league-rehearsal.ts)
and its [test](../web-app/src/features/draft-room/primary-league-rehearsal.test.ts).
The fixture does not read the live draft ID or schedule. Review its constants
when intentionally changing the acceptance profile.

## Real-provider rehearsal

Follow this sequence when the task calls for a connected rehearsal:

1. Run `pnpm dev:live`. This refreshes live draft inputs and writes local reports as described in [data-refresh.md](data-refresh.md).
2. Connect the draft designated in `data/primary-league-rehearsal.json` and confirm the manager's draft slot.
3. Check the current provider scoring, roster limits, round count, and keeper assignments against the intended profile.
4. Follow provider picks through draft completion and verify that the local draft records them once.
5. During the planned outage exercise, disconnect local synchronization. Record one matching Provisional Pick, one conflicting Provisional Pick, and one extra local pick.
6. Restore synchronization. Confirm the visible reconciliation summary and verify the corrected rosters and available-player pool. These local entries do not submit picks to Sleeper.
7. Check the final slot count and roster sizes against the confirmed profile. For the saved 2026 profile, expect 140 canonical slots and 14 players per roster.
8. Record the outcome, observations, and completion time in `realProviderRehearsal`. Set `status` to `passed` only after the connected workflow has completed successfully.
9. Run the release gate below.

Opening the connection dialog, rendering `/sidepanel`, or passing fixture tests
does not prove provider polling, extension detection, or live outage recovery.
Record which entry points were actually exercised. If a prerequisite prevents
the run, leave the real-provider outcome incomplete and name that prerequisite.

## Release gate

For release preparation, run:

```bash
pnpm draft:release-gate
```

The [gate runner](../scripts/src/primary-league-release-gate.ts) executes builds,
type checking, lint, unit and integration tests, strict data-quality checks,
Draft Readiness, and the deterministic rehearsal. It reads the recorded
real-provider result; it does not perform that rehearsal or refresh the source
data. The command rewrites the readiness, data-quality, deterministic-rehearsal,
and release-gate reports, plus local build outputs.

A failing engineering check or incomplete product evidence blocks release.
Inspect the named failure before refreshing data or rerunning checks. Optional
Signal degradation remains separate from Core Draft Data blockers, although a
failure from a strict data-quality command still fails that release check.

The gate requires a real-provider `passed` status and a valid completion time
that is not in the future. It cannot independently verify the recorded manual
evidence. Never change a timestamp or result just to make the gate pass.

## Feature freeze

Feature freeze activates only when all recorded release checks and both
rehearsals pass. While it is active, changes are limited to data refreshes,
rehearsal fixes, and defects that threaten Draft Readiness. Read the current
gate result before applying this restriction; the existence of this runbook
does not activate a freeze.
