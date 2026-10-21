# Characterize draft-session persistence

This separate browser check calls the running app's live workspace on `/draft` and inside the installed unpacked extension's `/sidepanel` iframe. The React app stays mounted. The adapter obtains the composition root's instance through `/src/workspace/browser-workspace.ts`, reads `workspace.draft.getState()`, and writes through `workspace.send(...)`. Its slot helper is pure shared code. It creates no alternate store or workspace owner.

Install dependencies and local demo data, then build the unpacked extension:

```sh
pnpm install --frozen-lockfile --prefer-offline
pnpm data:demo:install
pnpm build:extension
pnpm --filter scripts exec playwright install chromium
pnpm test:persistence
```

The runner owns a demo-only Vite server on `127.0.0.1:3000`. Port 3000 must be free. Both `localhost` and `127.0.0.1` reach that listener. Hot reload and file watching are disabled. It uses fresh private Chromium profiles, blocks external page requests, and closes its own browser contexts and server in `finally`. It never runs live preflight or provider refreshes. The synthetic extension pairing token only hides the unpaired overlay. It creates no server pairing.

The default output is `artifacts/persistence/results.json`. Override `PERSISTENCE_OUTPUT` with an absolute results directory. The directory also retains profiles, a copied extension without local host permissions, and side-panel screenshots. Do not commit these artifacts.

The defaults are three suites, five seeds per suite, and two actors with 300 commands each. Each scenario submits 9,000 commands. The four scenarios are `tabs`, `extension-granted`, `extension-no-permission`, and `hostname-split`. `PERSISTENCE_SCENARIOS` accepts a comma-separated subset. `PERSISTENCE_SUITES` and `PERSISTENCE_SEEDS` accept positive integers. `PERSISTENCE_EXECUTABLE` selects an installed Chromium executable. Launch options, effective browser arguments, permission grants, and the user agent appear in the results. Third-party storage partitioning must remain enabled, as in unit 0.

## Interpret the counts

The workload alternates unique provisional picks and unique shortlist additions. Actors use disjoint player IDs and pick slots in a supported 20-team, 20-round linear draft. It copies P9's LCG seed arithmetic and requested 0 to 5 ms timer jitter. It keeps unit 0's 300 commands per actor and five seeds, repeated three times.

This is an adaptation of P9, not its four-operation random workload. Today's store has no retained command log, so a superseded queue edit cannot be counted as a missing command. Unique additions make every acknowledged effect independently observable after reload. Each scenario runs 20 independent pick-conflict samples and 20 independent queue-move samples. They exercise two picks for one slot and opposite moves of one queue member. Every sample retains its receipts, settled and reloaded snapshots, original head and journal bytes, parsed storage records, and both the 11b and future conflict audits. The move adapter translates P9's destination index into the app's offset argument.

A pick is acknowledged only when `recordProvisionalPick` returns true. A queue addition is acknowledged when the synchronous action leaves the player in that actor's queue. These are the current app's acknowledgement semantics, not a promise that its disk write succeeded. Rejections are counted separately. Setup actions, sequential controls, and conflict commands are excluded from stress totals.

`kept` and `lost` use the reloaded top-level tab as the common session. `keptByTarget`, both missing-ID lists, and `unionMissing` distinguish a deleted effect from separate partitions. A missing-permission or hostname-split row can have half the commands in each partition, with nothing physically deleted. Such a row still fails the shared-session contract. `converged` compares pick identity and exact queue order. `unique` checks slots, players, and queue members. Raw heads and journals are captured before and after reload, including sequential controls.

Each scenario also runs the actors sequentially. Shared-origin sequential success alongside concurrent loss rules out an invalid command workload as the explanation. Negative scenarios retain their partition split in that control too.

The ordinary command exits successfully when characterization completes, even when it finds trunk defects. Add `--gate` after the command to fail on stress loss, rejection, storage errors before or after reload, divergence, invariant violations, page errors, sequential-control failures, conflict failures, or writes accepted in a negative scenario:

```sh
pnpm test:persistence --gate
```

The negative scenarios currently permit writes. Unit 11c must change those cases to assert a blocking permission or setup flow and zero acknowledged writes, rather than merely observe partition divergence. Unit 11c must also add trusted lifecycle recovery and real old-module rollout cases. Passing this script alone does not prove migration, native visibility behavior, disk quota durability, or process-crash recovery.

A failure in one scenario is retained in `scenarioErrors`; the runner continues to later scenarios and exits unsuccessfully. A future negative setup screen that prevents the frame from loading is currently recorded as an incomplete scenario, never counted as zero lost commands. Unit 11c must replace that observation with explicit blocked-write assertions.

Recompute the audit from retained raw receipts and snapshots without launching a browser:

```sh
node scripts/persistence/check-results.mjs /absolute/results.json
node scripts/persistence/check-results.mjs /absolute/results.json --gate-11b
node scripts/persistence/check-results.mjs /absolute/results.json --gate
```

The first command verifies completed run counts, identities, modes, and saved audit values. `--gate-11b` also applies the non-regression checks below. `--gate` applies the separate future durability gate. A completed characterization with known trunk defects can pass the 11b comparison while failing the future gate. Summary fields such as `conflictFailures` retain the stricter future semantics; `checks11b` and `bands11b` report the 11b result.

## Check the 11b non-regression bands

Run the unchanged full stress matrix with the 11b gate:

```sh
pnpm test:persistence --gate-11b
```

`bands-11b.mjs` recomputes the comparison from raw receipts, snapshots, and storage records. Both the runner and `check-results.mjs` use it. It requires all four scenarios, three suites of five seeds, 300 commands per actor, and 20 samples of each conflict kind per scenario. Subsets and smaller smoke runs remain available for characterization but cannot pass this gate.

The tabs baseline loses 3,893 of 9,000 effects. Its allowed aggregate loss is 3,443 through 4,343, inclusive, and its maximum per-run loss is 300 of 600. The permission-granted extension baseline loses 3,589 of 9,000. Its allowed aggregate loss is 3,139 through 4,039, inclusive, and its maximum per-run loss is 294 of 600. These bounds apply +/-5 percentage points in aggregate and the characterized worst run plus 30. They describe this stress schedule and do not establish durability.

Every shared-storage run must acknowledge 600 commands, converge without duplicate players, slots, or queue members, and show no additional loss on reload. Shared sequential controls must retain all 600 effects. A positive pick conflict may acknowledge one or two commands but must retain at least one acknowledged pick, converge, and have no duplicate players or slots. Shared queue moves require a valid permutation and the exact same settled order before and after reload.

Negative stress and sequential controls must retain each actor's own 300 effects, retain all 600 in union, and keep distinct stored sessions for the same draft identity. Negative conflict samples must retain each partition's own acknowledged pick or queue move. Storage-sharing markers, live identities, original storage bytes, storage errors, page errors, incomplete scenarios, and missing samples are also checked.

Run the standalone audit tests without starting a browser:

```sh
node --test scripts/persistence/check-audit.mjs
```
