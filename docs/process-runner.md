# Run Node commands

Import `Processes`, `ProcessError`, and `runNodeMain` from `@fantasy-draft/shared/node`. Browser source imports `localDevPorts` from `@fantasy-draft/shared/sync`. The Node subpath retains that export for existing Node callers.

`Processes.run(command, args, options)` returns a promise with the exit code, signal, stdout, stderr, and truncation flags. Set `timeoutMs` explicitly. Non-zero exits reject with `ProcessError`, which carries the executable, arguments, exit code, and bounded output. It never retains the environment or includes captured output in its message.

`Processes.service` starts a command with the same options and returns its PID, exit observation, result promise, and an idempotent `stop()`. Await `stop()` in a resource finalizer. Effect callers use `Effect.callback` and return `Effect.promise(() => service.stop())` as cleanup. An interrupted `Effect.tryPromise` alone does not wait for child exit.

On POSIX, each child starts in its own process group. Cancellation and timeout record descendant groups before sending SIGTERM, then SIGKILL if any remain alive after the grace period. This also covers nested runners when a watcher kills their parent. Completion waits for the child to close and for live group members to exit. Piped output drains before completion. A descendant that holds a pipe open is bounded by the command timeout. After pipes close, any remaining live group members are stopped. Windows uses `taskkill /T /F` and waits for the child to close. A descendant that creates a new session and loses its ancestry before shutdown cannot be discovered after reparenting.

The default capture mode retains the last 1 MiB per stream. `maxOutputBytes` changes that per-stream limit. `output: 'tee'` also mirrors captured streams to the terminal, as refresh did before. `output: 'inherit'` passes terminal descriptors directly, preserving terminal detection. `output: 'ignore'` discards output. Inherit and ignore modes return empty captures. Output observers require capture or tee mode and receive live output independently of the capture cap. Input defaults to ignored. Set `stdin: 'inherit'` for interactive commands.

The default SIGTERM grace is 1 second, followed by a 5-second SIGKILL wait. Refresh keeps its prior 10-second SIGTERM grace and 5-second kill wait. The preflight now has a 5-minute limit per step. Release checks have 30-minute limits. The browser gate validates `BROWSER_GATE_MAX_MINUTES` as a finite positive number (default 240 minutes), gives Vite another 5 minutes for cleanup, and bounds each check with `BROWSER_GATE_CHECK_TIMEOUT_MS` (default 240,000 ms). CI gives the separate Node 24 browser-gate job 30 minutes and the gate itself 20 minutes. Effect adoption's git commands have 60-second limits. Development services have a 24-hour limit and a 20-second SIGTERM grace to allow graceful watcher shutdown. The runner tracks nested refresh groups before a watcher can force its server to exit. These limits replace unbounded waits outside refresh.

`runNodeMain(signal => program(signal))` owns SIGINT, SIGTERM, and SIGHUP handling. It waits for the program's cleanup, sets exit code 130 after interruption, and reports ordinary failures with exit code 1. Repeated signals do not bypass cleanup. The scripts' Effect adapter delegates to it. This replaces the adapter's immediate second-signal exit and forced exit after 5 seconds, which could abandon resource finalizers.

`pnpm dev` starts the same four watchers through this runner. A failed watcher stops its siblings and returns a failure. Ctrl-C stops all four owned groups. The previous shell command could leave siblings alive and report only the last background exit status. The Python verification supervisor now records descendant identities and their owned groups before shutdown, then waits and escalates across those groups even if the original leader exits. It no longer treats the leader exiting as proof that its descendants stopped.

The Node catalog reader, `readCatalogArtifact(root, path)`, owns readiness file reads for the CLI and scripts. It returns the same read-error evidence as before. Catalog decoders still own validation.

## Lint exceptions

`agent/no-bare-child-process` rejects static imports, re-exports, dynamic imports, `require`, and TypeScript import forms outside `shared/src/node/**`. Its error names `Processes` as the replacement. Tooling exceptions are exact paths in `eslint.config.js`. The test exception is the glob `**/*.test.{ts,tsx,mjs}`:

- Test files launch isolated fixtures and built-package contract subprocesses. They must be able to test the runner independently.
- `scripts/probe-source-condition.mjs` changes a shared source signature and checks consumers before a rebuild. Depending on built shared would weaken that probe.
- `scripts/probe-workspace-gates.mjs` deliberately removes workspace scripts. Its subprocess must run before project setup is known to work.
- `scripts/probe-agent-gates.mjs` replays historical code against lint rules without requiring a shared build.
- `scripts/audit-unused-exports.mjs` reads historical git blobs synchronously inside TypeScript compiler-host callbacks. A promise runner cannot implement those synchronous callbacks.

These tooling exceptions retain their existing process behavior. They do not start application services. New tooling files do not inherit an exception.


## Browser gate tiers

`pnpm browser:gate` runs the full registry. `pnpm browser:gate:smoke` runs the checks tagged `smoke`: one width per visual fixture, the 1280x800 draft room, assistant cold load and glance, light-theme axe on draft and assistant, the hung Draft save, side panel banner, and draft flow. Route failure is full-only, as agreed in the test audit's cross-lane decisions.

`pnpm browser:gate:tiered` runs smoke first. A failed smoke tier triggers the full registry in the same Vite and Chromium session. Both summaries are printed; the full tier determines the exit code. `BROWSER_GATE_TIER=smoke|full|tiered` selects the same modes directly. `BROWSER_GATE_ONLY=<regex>` filters labels within those modes; an empty selection fails.

`BROWSER_GATE_WORKERS` defaults to half the available CPUs, rounded down, with a minimum of one and maximum of four. Each check owns fresh browser contexts and IndexedDB/localStorage. The built-extension axe checks run serially because they share `extension/dist`; browser-only routing, fault hooks and themes remain context-local. Vite dependency discovery and lazy-route transforms are pre-warmed before workers start. Timeouts close only the affected check's contexts. Concurrent outage reports share one Vite restart. The late-board check seeds pick 11.05 at `/__visual/board-late` and measures both laptop sizes and both themes on one page. Fixed names keep text-clipping failures independent of demo rankings and CPU draft choices.

The CI `verify` matrix keeps Node 22.18 and 24 code verification. The separate Node 24 `browser-gate` job runs tiered on PRs, or full on main pushes, the `full-gate` PR label, and gate source changes. That job also builds and checks the hosted IndexedDB demo with `flip-demo.mjs`.
