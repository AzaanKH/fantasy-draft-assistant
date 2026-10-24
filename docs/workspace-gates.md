# Workspace gates

Run `pnpm verify` for type checking, lint, tests, and builds. Install the local demo fixtures with `pnpm data:demo:install` in a fresh checkout.

`eslint.config.js` owns lint policy. `vitest.config.js` owns test projects and the shared `restoreMocks`, `unstubGlobals`, and `unstubEnvs` policy. `gate-workspaces.js` records the package environments. Browser and extension globals, React hooks, and Node test relaxations remain separate config blocks.

`pnpm lint` first checks every package selected by `pnpm-workspace.yaml` for `lint`, `typecheck`, `test`, and `build` scripts. It also checks effective ESLint coverage and test discovery. Add a new workspace to `gate-workspaces.js` and supply all four scripts. There are no gate exemptions.

Package commands still work, for example `pnpm --filter @fantasy-draft/cli lint` and `pnpm --filter extension test`. Each command checks only that workspace.

## Source and built package resolution

TypeScript, Vite, Vitest, and the package scripts that use tsx select `@fantasy-draft/source`. Consumers read the selected `shared/src/<subpath>/index.ts` even when `shared/dist` is absent or stale. For an ad hoc tsx command, pass `--conditions=@fantasy-draft/source`.

`pnpm test` runs ordinary suites without a build. The shared package contract tests deliberately use plain Node and the published declarations. `pnpm build` runs them after all builds through `pnpm test:contracts`. Run `pnpm test:contracts` directly only after building shared.

Server and scripts builds use separate TypeScript configs with the source condition disabled, so emitted Node imports still resolve the built shared package. Shared build forces emission to recover when dist was deleted but TypeScript's incremental metadata remains.

## Existing lint violations

`eslint-baseline.json` records counts by source file and rule, with a reason for each entry. `scripts/lint.mjs` checks each workspace with the root ESLint config, compares those counts, and reports ordinary lint errors. The root command keeps pnpm's parallel workspace scheduling. The baseline covers existing JSON casts, cross-package imports including the CLI's web-app alias, and exported functions without boundary annotations. Tests keep their existing fixture relaxations and do not use these production baselines.

When you remove a violation, lower or remove its baseline entry. Deleted and renamed files also require updates. Growth in any file or rule fails, even if another count decreases. Fix the new violation. Decode external JSON with a shared decoder and import packages through public exports.

`agent/no-bare-fetch` is an error for production files outside `shared/src/http/**` and has no baseline allowance. It covers production files throughout each workspace, including files outside `src`. Mock and local-server harnesses matching `**/*.test.{ts,tsx,mjs}` keep their test exclusion and need no baseline entries. For HTTP requests, use `@fantasy-draft/shared/http`. The rule catches native references, including `globalThis.fetch`, `window.fetch`, `self.fetch`, `global.fetch`, nested global objects, static computed properties, destructuring, and bound aliases. Local bindings named `fetch` and unrelated object methods remain valid. Writes to native fetch properties also produce a diagnostic. For production visual mocks, inject a transport through `HttpOptions` instead of replacing `window.fetch`. Type-only `typeof fetch` references remain valid.

`agent/no-position-array` and `agent/no-inline-season` cover production source outside `shared/src/league/**` under the same ratchet. Name position groups from `@fantasy-draft/shared/league` (`POSITIONS`, `OFFENSIVE_POSITIONS`, `KICKER_DEFENSE_POSITIONS`, `FLEX_GROUPS`) and read FLEX eligibility from the league's roster requirements with `isFlexEligible`, so superflex leagues admit QBs. Arrays that repeat a position are fixture sequences and stay valid. The rule also flags quoted position lists inside strings and SQL templates, such as `in ('QB', 'RB')`; build those with `sqlPositionList`. Use `calendarSeason` instead of reading a year from a `Date`; `shared/src/http/**` parses HTTP dates and is exempt. The league bonus rule has one TypeScript source and a generated DuckDB expression, `leagueScoringAdjustmentSql`; `scripts/src/model/league-scoring-sql.test.ts` checks that both agree on a fixed corpus.

`@fantasy-draft/shared/units` brands `Probability` (0 to 1), `Percent` (0 to 100), `Rank` (1 is best) and `Vor`. They are numbers at runtime, but TypeScript rejects mixing them and rejects an unbranded number where a unit is expected. Create them with `asProbability`, `asPercent`, `asRank` or `asVor` where decoded data becomes domain data; `agent/no-unit-cast` rejects `as` casts to a unit outside `shared/src/units/**`. Readiness minimums live in `READINESS_MINIMUMS` from `@fantasy-draft/shared/catalog`; the browser check, the CLI readiness report and the data-quality script read them.

Run `node scripts/probe-agent-gates.mjs` to check all new rules against a scratch source file. Run `node scripts/probe-workspace-gates.mjs` to check missing scripts and missing config coverage. After building shared, `node scripts/probe-source-condition.mjs` checks that a temporary shared signature change fails consumer typecheck without rebuilding dist. The probes restore their inputs and remove their scratch files. Run `node scripts/probe-agent-gates.mjs --replay` to replay the native fetch check against `a4696c0^:server/src/sync-server.ts` and global, computed, and alias fixtures without making requests.

Import shared contracts through exact subpaths: `/league` for players, positions, scoring and rosters; `/draft` for draft order and recommendations; `/catalog` for data and readiness; `/sync` for provider sync and draft URLs; `/units` for limits; `/node` for local process configuration; `/http` for HTTP requests. The `/http` entry point and its dependencies stay Effect-free; the built package contract checks this under plain Node. The bare `@fantasy-draft/shared` root and temporary `/draft-url` path are not exported. `agent/no-closed-root-import` rejects root imports.

## HTTP requests

`http.json(url, decode, policy, options)` and `http.events(url, decode, policy, options)` require a decoder from unknown JSON to the caller's value. `http.text` and `http.bytes` handle non-JSON bodies. Every policy supplies `timeoutMs`, `retries` and `retryAfter`. The timeout covers headers and body per attempt. Events also require `idleMs` and `maxEventBytes`. The idle deadline resets on decoded events, so incomplete frames or comments cannot keep a stream alive. Their owner cancels the stream on consumer return.

The runner retries 429 and 503 by default when the explicit retry count permits it. The default backoff is 1,500 ms times the retry number. Retry-After accepts seconds and HTTP dates, keeps the existing 500 ms minimum, and stops rather than retrying early when the requested delay exceeds the default 10,000 ms limit. Retries add positive jitter below 10% of the delay, capped at 250 ms. Options allow injected fetch, time and randomness for tests. Caller abort cancels body reads and retry waits. `HttpError` distinguishes timeout, abort, network, status, invalid JSON and invalid stream failures, and strips credentials, query and fragment from its URL.
