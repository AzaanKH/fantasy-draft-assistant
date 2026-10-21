# Characterize draft-session persistence

This separate browser check calls the running app's real default `useDraftStore` singleton on `/draft` and inside the installed unpacked extension's `/sidepanel` iframe. The React app stays mounted. The adapter imports the app's Vite store module URL. Its slot helper is pure shared code. It adds no reducer, persistence implementation, production export, or production build entry.

Install dependencies and local demo data, then build the unpacked extension:

```sh
pnpm install --frozen-lockfile --prefer-offline
pnpm data:demo:install
pnpm build:extension
pnpm --filter scripts exec playwright install chromium
node --test scripts/persistence/check-audit.mjs
pnpm test:persistence
```

The runner owns a demo-only Vite server on `127.0.0.1:3000`. Port 3000 must be free. Both `localhost` and `127.0.0.1` reach that listener. Hot reload and file watching are disabled. It uses fresh private Chromium profiles, blocks external page requests, and closes its own browser contexts and server in `finally`. It never runs live preflight or provider refreshes. The synthetic extension pairing token only hides the unpaired overlay. It creates no server pairing.

The default output is `artifacts/persistence/results.json`. Override `PERSISTENCE_OUTPUT` with an absolute results directory. The directory also retains profiles, a copied extension without local host permissions, and side-panel screenshots. Do not commit these artifacts.

The defaults are three suites, five seeds per suite, and two actors with 300 commands each. Each scenario submits 9,000 commands. The four scenarios are `tabs`, `extension-granted`, `extension-no-permission`, and `hostname-split`. `PERSISTENCE_SCENARIOS` accepts a comma-separated subset. `PERSISTENCE_SUITES` and `PERSISTENCE_SEEDS` accept positive integers. `PERSISTENCE_EXECUTABLE` selects an installed Chromium executable. Launch options, effective browser arguments, permission grants, and the user agent appear in the results. Third-party storage partitioning must remain enabled, as in unit 0.

## Interpret the counts

The workload alternates unique provisional picks and unique shortlist additions. Actors use disjoint player IDs and pick slots in a supported 20-team, 20-round linear draft. It copies P9's LCG seed arithmetic and requested 0 to 5 ms timer jitter. It keeps unit 0's 300 commands per actor and five seeds, repeated three times.

This is an adaptation of P9, not its four-operation random workload. Today's store has no retained command log, so a superseded queue edit cannot be counted as a missing command. Unique additions make every acknowledged effect independently observable after reload. Separate conflict cases exercise two picks for one slot and opposite moves of one queue member. The move adapter translates P9's destination index into the app's offset argument.

A pick is acknowledged only when `recordProvisionalPick` returns true. A queue addition is acknowledged when the synchronous action leaves the player in that actor's queue. These are the current app's acknowledgement semantics, not a promise that its disk write succeeded. Rejections are counted separately. Setup actions, sequential controls, and conflict commands are excluded from stress totals.

`kept` and `lost` use the reloaded top-level tab as the common session. `keptByTarget`, both missing-ID lists, and `unionMissing` distinguish a deleted effect from separate partitions. A missing-permission or hostname-split row can have half the commands in each partition, with nothing physically deleted. Such a row still fails the shared-session contract. `converged` compares pick identity and exact queue order. `unique` checks slots, players, and queue members. Raw heads and journals are captured before and after reload.

Each scenario also runs the actors sequentially. Shared-origin sequential success alongside concurrent loss rules out an invalid command workload as the explanation. Negative scenarios retain their partition split in that control too.

The ordinary command exits successfully when characterization completes, even when it finds trunk defects. Add `--gate` after the command to fail on stress loss, rejection, storage errors before or after reload, divergence, invariant violations, page errors, sequential-control failures, conflict failures, or writes accepted in a negative scenario:

```sh
pnpm test:persistence --gate
```

The negative scenarios currently permit writes. Unit 11c must change those cases to assert a blocking permission or setup flow and zero acknowledged writes, rather than merely observe partition divergence. The adapter must move to `useWorkspace().send` in 11b, preserving these command intents and acknowledgement checks. Unit 11c must also add trusted lifecycle recovery and real old-module rollout cases. Passing this script alone does not prove migration, native visibility behavior, disk quota durability, or process-crash recovery.

A failure in one scenario is retained in `scenarioErrors`; the runner continues to later scenarios and exits unsuccessfully. A future negative setup screen that prevents the frame from loading is currently recorded as an incomplete scenario, never counted as zero lost commands. Unit 11c must replace that observation with explicit blocked-write assertions.

Recompute the audit from retained raw receipts and snapshots without launching a browser:

```sh
node scripts/persistence/check-results.mjs /absolute/results.json
node scripts/persistence/check-results.mjs /absolute/results.json --gate
```

The first command verifies completed run counts, identities, modes, and every saved audit value. The second also applies the future durability gate. A completed characterization with known trunk defects passes the first command and fails the second.
