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

The script counts Effect constructs and the hand-written control flow they replace in non-test source files, after stripping comments. It measures the baseline revision in a temporary git worktree, so local edits never mix into it. The counts come from regular expressions, so compare revisions with them rather than treating them as exact syntax counts.

## Source changes

These counts cover the four converted workspaces, from `main` to the end of the adoption stack.

| Metric | cli | server | scripts | extension |
| --- | ---: | ---: | ---: | ---: |
| Files using Effect | 0 → 7 | 0 → 8 | 0 → 15 | 0 → 2 |
| Non-blank lines | 1218 → 1249 | 1951 → 1951 | 10992 → 10957 | 2175 → 2162 |
| `throw` statements | 54 → 18 | 37 → 21 | 31 → 20 | 5 → 5 |
| `try` blocks | 22 → 6 | 18 → 9 | 26 → 12 | 14 → 11 |
| `AbortSignal` plumbing | 27 → 4 | 12 → 2 | 2 → 2 | 2 → 1 |
| Manual timers | 6 → 0 | 13 → 4 | 3 → 1 | 15 → 13 |
| Declarative timeouts | 0 → 3 | 0 → 3 | 0 → 1 | 0 → 1 |
| Tagged error classes | 0 → 2 | 0 → 3 | 0 → 1 | 0 → 1 |

Across the four workspaces, `throw` statements fell from 127 to 64, `try` blocks from 80 to 38, and `AbortSignal` handling from 43 to 9. Code size stayed within 1%. The remaining extension timers belong to the content scripts, which were left alone on purpose.

## Runtime cost

| Measurement | `main` | Effect | Change |
| --- | ---: | ---: | ---: |
| CLI bundle (`cli/dist/draft.js`) | 227 kB (53 kB gzip) | 365 kB (85 kB gzip) | +138 kB |
| Extension service worker (`background.js`) | 18.2 kB (5.1 kB gzip) | 90.9 kB (22.3 kB gzip) | +72.7 kB |
| Extension content scripts | 11.3 and 20.4 kB | 11.3 and 20.4 kB | none |
| `draft --help`, median of 20 runs | 73 ms | 78 ms | +5 ms |
| `draft readiness --json`, median of 20 runs | 109 ms | 116 ms | +7 ms |
| Sync server request, median of 3,000 | 0.143 ms | 0.158 ms | +0.015 ms |

The CLI timings ran both builds alternately against the same data directory. The server timings used `GET /api/sync/sessions` with an authenticated token. All runs were on one MacBook with Node 22.21.

## Behavior changes

Each change below was checked against a running process, not only the unit tests.

- The CLI `watch` command still reconnects after 30 seconds of silence and backs off exponentially. A server that stops responding now reports `SERVER_UNAVAILABLE` with a message to start the server. Before, it reported a generic `COMMAND_FAILED`.
- The sync server polls each draft in one fiber per session, using a 1-second interval with 1-, 2-, and 4-second backoff after failures. Polling stops when the last client disconnects, and shutdown leaves no timers running. A stalled provider now reports `Sleeper request timed out` instead of `This operation was aborted`.
- The Sleeper player fetch in `pnpm refresh:sleeper` had no timeout, so a slow API could stall `pnpm dev:live` preflight. It now times out after 60 seconds. It also retries rate limits and server errors, honoring `Retry-After`.
- `pnpm import:league-history` sent every season's requests at once. It now runs two seasons at a time.
- Ctrl-C now releases DuckDB connections and Playwright browsers. Scripts that use them exit with code 130 after cleanup. DuckDB cancels a running query first, because closing a connection otherwise waits for a slow remote Parquet read. A second Ctrl-C, or cleanup longer than five seconds, exits immediately.
- When the extension sends a newer snapshot request for a draft, the older request is now cancelled. Before, the older request ran to completion and the controller discarded its result.

## Bugs fixed along the way

- `scrape-contracts.ts` called `process.exit(1)` inside its `catch` block, so its `finally` never closed the browser after a failure.
- `scrape-ecr.ts` launched the browser before its `try` block, so a failure while opening the page left the browser running.

## Known issues not addressed

`pnpm scrape:ecr` finds 559 rows but parses none, and `pnpm scrape:contracts` finds no rows. Both fail the same way on `main`, so the conversion did not cause this. The source pages have probably changed. The FantasyPros API remains the primary rankings source.

## Possible next steps

- Replace the hand-written type guards in `cli/src/archive.ts`, `cli/src/data.ts`, and the server adapters with `Schema` from `effect`. The guards make up most of the remaining `throw` statements and `as` casts.
- Run the server's fibers on one `ManagedRuntime`. The server calls the Effect runtime in six places. Three start a request, a poll loop, or a refresh job, and three interrupt a fiber.
- Move CLI argument parsing to `effect/cli` once the JSON error contract can be kept.
- Adopt the Effect language service (`@effect/tsgo`) after `typescript-eslint` supports TypeScript 7.
