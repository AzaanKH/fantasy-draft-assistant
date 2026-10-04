# Effect adoption

This repository uses [Effect 4](https://effect.website/docs/v4/onboarding) for code that talks to other systems: HTTP requests, the live draft event stream, files, child processes, DuckDB, and Playwright. Pure draft logic and React stay plain TypeScript. This guide records where Effect is used, what it changed, and what it costs, measured against `main` before adoption (commit `770b4ff`).

## Where Effect is used

| Area | Effect code | Plain TypeScript |
| --- | --- | --- |
| `cli/` | Server client, event stream, file I/O, command dispatch | Argument parsing, draft context, roster |
| `server/` | Session polling, provider adapters, ADP provider, shadow log, request handling, Core Draft Data refresh | `local-auth.ts`, which runs synchronously at startup and is shared with Vite |
| `scripts/` | FantasyPros, Sleeper, and league-history requests; DuckDB connections; Playwright browsers; script entry points that use them | Data-crunching bodies such as model training and backtests |
| `extension/` | Background sync client and controller | Content scripts, which Chrome injects into draft pages |
| `shared/`, `web-app/` | None | Everything |

The content scripts stay plain because each one ships inside ESPN or Sleeper pages, and Effect would add about 70 kB to every injected bundle. `shared` and `web-app` contain pure calculations and React state, which have no effects to manage.

Follow the patterns in [AGENTS.md](../AGENTS.md#effect) when writing new Effect code.

## Measuring adoption

Run this from the repository root:

```sh
pnpm measure:effect-adoption --baseline 770b4ff
```

The script counts Effect constructs and the hand-written control flow they replace in non-test source files. It parses each file with the TypeScript compiler, blanks string, template, and regex literals, and strips comments, so pattern text inside a literal is not counted. It finds files that use Effect from their import declarations. It measures the baseline revision in a temporary git worktree, so local edits never mix into it. The patterns themselves are regular expressions over the remaining code, so compare revisions with them rather than treating them as exact syntax counts.

## Source changes

These counts cover the four converted workspaces, from `main` to the end of the adoption stack.

| Metric | cli | server | scripts | extension |
| --- | ---: | ---: | ---: | ---: |
| Files using Effect | 0 → 7 | 0 → 8 | 0 → 15 | 0 → 2 |
| Non-blank lines | 1218 → 1289 | 1951 → 2005 | 10992 → 10993 | 2175 → 2170 |
| `throw` statements | 54 → 21 | 37 → 21 | 31 → 23 | 5 → 5 |
| `try` blocks | 22 → 9 | 18 → 9 | 26 → 15 | 14 → 11 |
| `AbortSignal` plumbing | 27 → 6 | 12 → 2 | 2 → 3 | 2 → 1 |
| Manual timers | 6 → 0 | 13 → 4 | 3 → 1 | 15 → 13 |
| Declarative timeouts | 0 → 3 | 0 → 5 | 0 → 1 | 0 → 1 |
| Tagged error classes | 0 → 2 | 0 → 3 | 0 → 2 | 0 → 1 |

Across the four workspaces, `throw` statements fell from 127 to 70, `try` blocks from 80 to 44, and `AbortSignal` handling from 43 to 12. Code size grew 0.7%. The CLI and scripts each read HTTP bodies with an explicit reader that cancels on abort, which accounts for some of the remaining `try` blocks and signal handling. The remaining extension timers belong to the content scripts, which were left alone on purpose.

## Runtime cost

| Measurement | `main` | Effect | Change |
| --- | ---: | ---: | ---: |
| CLI bundle (`cli/dist/draft.js`) | 227 kB (53 kB gzip) | 366 kB (85 kB gzip) | +139 kB |
| Extension service worker (`background.js`) | 18.2 kB (5.1 kB gzip) | 91.2 kB (22.4 kB gzip) | +73.0 kB |
| Extension content scripts | 11.3 and 20.4 kB | 11.3 and 20.4 kB | none |
| `draft --help`, median of 20 runs | 73 ms | 78 ms | +5 ms |
| `draft readiness --json`, median of 20 runs | 108 ms | 116 ms | +8 ms |
| Sync server request, median of 3,000 | 0.144 ms | 0.158 ms | +0.014 ms |

The CLI timings ran both builds alternately against the same data directory. The server timings used `GET /api/sync/sessions` with an authenticated token. All runs were on one MacBook with Node 22.21.

## Behavior changes

Each change below was checked against a running process, not only the unit tests.

- The CLI `watch` command still reconnects after 30 seconds of silence and backs off exponentially. A server that stops responding now reports `SERVER_UNAVAILABLE` with a message to start the server. Before, it reported a generic `COMMAND_FAILED`. A server that sends headers and then stalls the body no longer keeps the CLI process alive after the timeout.
- The sync server polls each draft in one fiber per session at a 1-second interval. After failures it waits 2, 4, then 8 seconds, capped at 30, which is unchanged from `main`. Polling stops when the last client disconnects, and shutdown leaves no timers running. Concurrent refreshes share polls as before: six at once make two polls. A stalled provider now reports `Sleeper request timed out` instead of `This operation was aborted`.
- A Core Draft Data refresh step that times out now waits for its script to exit before reporting failure. The server sends SIGTERM, then SIGKILL after 10 seconds, so a new refresh cannot overlap a script that is still writing data.
- The Sleeper player fetch in `pnpm refresh:sleeper` had no timeout, so a slow API could stall `pnpm dev:live` preflight. It now times out after 60 seconds. It also retries rate limits and server errors, honoring `Retry-After`.
- `pnpm import:league-history` sent every season's requests at once. It now runs two seasons at a time.
- Ctrl-C now releases DuckDB connections and Playwright browsers. Scripts that use them exit with code 130 after cleanup. DuckDB cancels a running query first, because closing a connection otherwise waits for a slow remote Parquet read. A second Ctrl-C, or cleanup longer than five seconds, exits immediately.
- A newer snapshot request from the extension now cancels a stale read for the same draft. Before, the read ran to completion and the controller discarded its result. ESPN snapshot uploads are never cancelled.

## Bugs fixed along the way

- `scrape-contracts.ts` called `process.exit(1)` inside its `catch` block, so its `finally` never closed the browser after a failure.
- `scrape-ecr.ts` launched the browser before its `try` block, so a failure while opening the page left the browser running.

## Mistakes caught in review

A review of the first version of this stack found six regressions that the tests did not cover. Each now has a test that fails without its fix.

- Reading a response body in a separate Effect from `fetch` left the body outside the abort signal, so a timeout did not close a stalled connection. Even with one signal, aborting `fetch` did not reliably close a connection mid-read (about one run in three). The CLI and scripts now read bodies with a reader that cancels its stream on abort.
- A one-permit semaphore around polls made every concurrent refresh run its own poll, so six refreshes made 18 provider calls instead of 6. Callers now share the poll in progress.
- An `Effect.callback` cleanup that only sent SIGTERM let interruption finish while the child still ran. Cleanup now waits for the exit.
- Parsing in `Effect.map` turned a malformed payload into a defect, which skipped the FantasyPros fallback. Parsers now run in `Effect.try`.
- One cancellation slot for both reads and uploads let a status refresh cancel an ESPN upload.

## Known issues not addressed

`pnpm scrape:ecr` finds 559 rows but parses none, and `pnpm scrape:contracts` finds no rows. Both fail the same way on `main`, so the conversion did not cause this. The source pages have probably changed. The FantasyPros API remains the primary rankings source.

## Possible next steps

- Replace the hand-written type guards in `cli/src/archive.ts`, `cli/src/data.ts`, and the server adapters with `Schema` from `effect`. The guards make up most of the remaining `throw` statements and `as` casts.
- Run the server's fibers on one `ManagedRuntime`. The server calls the Effect runtime in seven places. Four start a request, a poll loop, a shared poll, or a refresh job, and three interrupt a fiber.
- Move CLI argument parsing to `effect/cli` once the JSON error contract can be kept.
- Adopt the Effect language service (`@effect/tsgo`) after `typescript-eslint` supports TypeScript 7.
- Test the declared minimum Node version (22.18) in CI.
