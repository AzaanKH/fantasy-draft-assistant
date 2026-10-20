# Run Node commands

Import `Processes`, `ProcessError`, and `runNodeMain` from `@fantasy-draft/shared/node`. Browser source imports `localDevPorts` from `@fantasy-draft/shared/sync`. The Node subpath retains that export for existing Node callers.

`Processes.run(command, args, options)` returns a promise with the exit code, signal, stdout, stderr, and truncation flags. Set `timeoutMs` explicitly. Non-zero exits reject with `ProcessError`, which carries the executable, arguments, exit code, and bounded output. It never retains the environment or includes captured output in its message.

`Processes.service` starts a command with the same options and returns its PID, exit observation, result promise, and an idempotent `stop()`. Await `stop()` in a resource finalizer. Effect callers use `Effect.callback` and return `Effect.promise(() => service.stop())` as cleanup. An interrupted `Effect.tryPromise` alone does not wait for child exit.

On POSIX, each child starts in its own process group. Cancellation and timeout send SIGTERM to that group, then SIGKILL if it remains alive after the grace period. Completion waits for the child to close and for live group members to exit. Normal completion also stops descendants that outlive the command. Windows uses `taskkill /T /F` and waits for the child to close. Children that deliberately create a new session are outside the group contract.

Each stream retains its last 1 MiB by default. `maxOutputBytes` changes that per-stream limit. `output: 'inherit'` mirrors both streams, while `output: 'ignore'` suppresses terminal output. Both still retain bounded diagnostics. `onStdout` and `onStderr` receive live output independently of the capture cap. Input defaults to ignored. Set `stdin: 'inherit'` for interactive commands.

The default SIGTERM grace is 1 second, followed by a 5-second SIGKILL wait. Refresh keeps its prior 10-second SIGTERM grace and 5-second kill wait. The preflight now has a 5-minute limit per step. The browser gate and release checks have 30-minute limits. Effect adoption's git commands have 60-second limits. Development services have a 24-hour limit and a 20-second SIGTERM grace so the server can finish its refresh cleanup. These limits replace unbounded waits outside refresh.

`runNodeMain(signal => program(signal))` owns SIGINT and SIGTERM handling. It waits for the program's cleanup, sets exit code 130 after interruption, and reports ordinary failures with exit code 1. Repeated signals do not bypass cleanup. The scripts' Effect adapter delegates to it. This replaces the adapter's immediate second-signal exit and forced exit after 5 seconds, which could abandon resource finalizers.

`pnpm dev` starts the same four watchers through this runner. A failed watcher stops its siblings and returns a failure. Ctrl-C stops all four owned groups. The previous shell command could leave siblings alive and report only the last background exit status. The Python verification supervisor now records descendant identities and their owned groups before shutdown, then waits and escalates across those groups even if the original leader exits. It no longer treats the leader exiting as proof that its descendants stopped.

The Node catalog reader, `readCatalogArtifact(root, path)`, owns readiness file reads for the CLI and scripts. It returns the same read-error evidence as before. Catalog decoders still own validation.

## Lint exceptions

`agent/no-bare-child-process` rejects static imports, re-exports, dynamic imports, `require`, and TypeScript import forms outside `shared/src/node/**`. Its error names `Processes` as the replacement. Exceptions are exact paths in `eslint.config.js`:

- Test files launch isolated fixtures and built-package contract subprocesses. They must be able to test the runner independently.
- `scripts/probe-source-condition.mjs` changes a shared source signature and checks consumers before a rebuild. Depending on built shared would weaken that probe.
- `scripts/probe-workspace-gates.mjs` deliberately removes workspace scripts. Its subprocess must run before project setup is known to work.
- `scripts/probe-agent-gates.mjs` replays historical code against lint rules without requiring a shared build.
- `scripts/audit-unused-exports.mjs` reads historical git blobs synchronously inside TypeScript compiler-host callbacks. A promise runner cannot implement those synchronous callbacks.

These tooling exceptions retain their existing process behavior. They do not start application services. New tooling files do not inherit an exception.
