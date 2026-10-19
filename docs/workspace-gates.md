# Workspace gates

Run `pnpm verify` for type checking, lint, tests, and builds. Install the local demo fixtures with `pnpm data:demo:install` in a fresh checkout.

`eslint.config.js` owns lint policy. `vitest.config.js` owns test projects and the shared `restoreMocks`, `unstubGlobals`, and `unstubEnvs` policy. `gate-workspaces.js` records the package environments. Browser and extension globals, React hooks, and Node test relaxations remain separate config blocks.

`pnpm lint` first checks every package selected by `pnpm-workspace.yaml` for `lint`, `typecheck`, `test`, and `build` scripts. It also checks effective ESLint coverage and test discovery. Add a new workspace to `gate-workspaces.js` and supply all four scripts. There are no gate exemptions.

Package commands still work, for example `pnpm --filter @fantasy-draft/cli lint` and `pnpm --filter extension test`. Each command checks only that workspace.

## Source and built package resolution

TypeScript, Vite, Vitest, and the package scripts that use tsx select `@fantasy-draft/source`. Consumers read `shared/src/index.ts` even when `shared/dist` is absent or stale. For an ad hoc tsx command, pass `--conditions=@fantasy-draft/source`.

`pnpm test` runs ordinary suites without a build. The two shared package contract tests deliberately use plain Node and the published declarations. `pnpm build` runs them after all builds through `pnpm test:contracts`. Run `pnpm test:contracts` directly only after building shared.

Server and scripts builds use separate TypeScript configs with the source condition disabled, so emitted Node imports still resolve the built shared package. Shared build forces emission to recover when dist was deleted but TypeScript's incremental metadata remains.

## Existing lint violations

`eslint-baseline.json` records counts by source file and rule, with a reason for each entry. `scripts/lint.mjs` runs ESLint once, checks those counts, and reports ordinary lint errors. The baseline covers existing JSON casts, fetch calls, cross-package imports including the CLI's web-app alias, and exported functions without boundary annotations. Tests keep their existing fixture relaxations and do not use these production baselines.

When you remove a violation, lower or remove its baseline entry. Deleted and renamed files also require updates. Growth in any file or rule fails, even if another count decreases. Fix the new violation. For fetch, use the shared HTTP runner planned for unit 8, or add to the baseline only with a reason. Decode external JSON with a shared decoder and import packages through public exports.

Run `node scripts/probe-agent-gates.mjs` to check all new rules against a scratch source file. Run `node scripts/probe-workspace-gates.mjs` to check missing scripts and missing config coverage. After building shared, `node scripts/probe-source-condition.mjs` checks that a temporary shared signature change fails consumer typecheck without rebuilding dist. The probes restore their inputs and remove their scratch files.
