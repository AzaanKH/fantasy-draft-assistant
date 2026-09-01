---
name: verify-fantasy-draft-assistant
description: Verify the Fantasy Draft Assistant through its React Draft Workspace and Draft Companion UI when checking local startup, draft-board behavior, navigation, mock drafting, a live read-only Sleeper mock-draft connection, roster settings, or captured browser evidence.
---

# Verify Fantasy Draft Assistant

Use this skill from the repository root. Read [features/README.md](features/README.md) and the matching feature file before driving the app.

## Scope

The primary user surface is the React Draft Workspace, normally at `http://localhost:3000/draft`. The Draft Companion at `/sidepanel` is a secondary web route and the matching Chrome extension lives under `extension/`. The local sync API normally listens on `127.0.0.1:3001`. Verification runs use isolated ports recorded in `run.json`.

The helper drives a fresh Playwright browser context. It never reuses a signed-in browser profile or an existing local app process. The app does not submit provider picks, but a connected provider draft can expose live draft state. Only use provider IDs supplied for the verification run.

## Prerequisites

- Run on Node 20 or newer and pnpm 9 or newer with workspace dependencies already installed.
- Keep a non-placeholder `FANTASYPROS_API_KEY` in the repository-root `.env.local`. The helper copies this file into disposable state and never prints the value.
- The helper chooses free web and API ports. It changes only the disposable copy's Vite proxy and development port check, then passes the API port and allowed web origin to the server. It never drives a listener it did not start.
- Expect the launch to call live Sleeper and FantasyPros endpoints. The mandatory `pnpm dev:live` preflight refreshes Core Draft Data.
- Do not use the checked-in manual FantasyPros fallback for this verification. On August 26, 2026, that fallback produced rankings without FantasyPros IDs, which made canonical identity coverage `0/321` and stopped startup.

## Launch

Choose a unique run ID and launch from the repository root:

```bash
RUN_ID="verify-$(date -u +%Y%m%dT%H%M%SZ)-$$"
node .agents/skills/verify-fantasy-draft-assistant/scripts/verify.mjs launch "$RUN_ID"
```

The helper copies the current checkout, including uncommitted files and `.env.local`, to `/tmp/fantasy-draft-assistant-verification/$RUN_ID/repo`. It links the installed `node_modules` directories, assigns free ports in that copy, runs `pnpm build`, then starts the required `pnpm dev:live` command in its own process group. This keeps port changes and preflight rewrites out of the working checkout.

Launch is ready only after all of these checks pass:

- The run-specific `$WEB_URL/draft` returns HTTP 200.
- The run-specific `$API_URL/api/health` returns HTTP 200 with `{"ok":true}`.
- The startup process remains alive.

Launch writes `run.json`, `build.log`, `build.json`, and `startup.log` under `.agents/skills/verify-fantasy-draft-assistant/artifacts/$RUN_ID/`.

## Doctor

Run this read-only safety check before the first drive and after any surprising failure:

```bash
node .agents/skills/verify-fantasy-draft-assistant/scripts/verify.mjs doctor "$RUN_ID" \
  | tee ".agents/skills/verify-fantasy-draft-assistant/artifacts/$RUN_ID/doctor.json"
```

Doctor requires the recorded process group to be alive, confirms that the run-specific listeners belong to that group, checks the three build outputs, reads both readiness endpoints, confirms the disposable data directory, requires FantasyPros API data, checks at least `98%` ranking identity coverage and all 32 defenses, and reports the credential as present without exposing it.

Do not drive the app when doctor fails. Do not stop or reuse an unknown listener.

## Drive

Use the scenario from the matching feature file:

```bash
node .agents/skills/verify-fantasy-draft-assistant/scripts/verify.mjs drive "$RUN_ID" workspace-queue
node .agents/skills/verify-fantasy-draft-assistant/scripts/verify.mjs drive "$RUN_ID" connection-dialog
node .agents/skills/verify-fantasy-draft-assistant/scripts/verify.mjs drive "$RUN_ID" mock-start
node .agents/skills/verify-fantasy-draft-assistant/scripts/verify.mjs drive "$RUN_ID" assistant-navigation
node .agents/skills/verify-fantasy-draft-assistant/scripts/verify.mjs drive "$RUN_ID" roster-settings
node .agents/skills/verify-fantasy-draft-assistant/scripts/verify.mjs drive "$RUN_ID" sidepanel-preview
```

The stable handles are route paths, ARIA labels, roles, and visible button names. Do not replace them with coordinates or generated Radix IDs.

The helper always opens a new browser context with no local storage. It does not inherit a saved provider connection. `connection-dialog` stops before submitting a provider ID. `sleeper-provider` submits only the explicit mock-draft URL passed on its command line and reads Sleeper through the app's normal server path. `mock-start` mutates only that disposable browser context.

Run the Sleeper provider rehearsal with a mock-draft URL supplied for this run. The optional slot defaults to `1`:

```bash
test -n "$SLEEPER_MOCK_URL"
node .agents/skills/verify-fantasy-draft-assistant/scripts/verify.mjs drive \
  "$RUN_ID" sleeper-provider "$SLEEPER_MOCK_URL" 1
```

The helper accepts only an HTTPS `sleeper.com/draft/nfl/<numeric-draft-id>` URL. It cannot tell whether the ID belongs to a mock or production draft, so the operator must supply a mock. The Fantasy Draft Assistant polls Sleeper's read-only API and never submits a provider pick.

## Evidence

Evidence lives at `.agents/skills/verify-fantasy-draft-assistant/artifacts/$RUN_ID/$SCENARIO/`:

- `before.png` and `after.png` show the user action and resulting UI with the app header visible.
- `before-aria.yml` and `after-aria.yml` record the user-facing accessibility state.
- `action.json` records the feature ID, route, stable handle, input, and observed result.
- `result.json` records pass or fail and the second read-only view used to confirm the result.
- `console.json` and `network-failures.json` preserve browser diagnostics.
- `trace.zip` contains the Playwright trace.
- `provider-snapshot.json` is added by `sleeper-provider`. It records the canonical provider, draft ID, status, settings, and picks returned by the local sync API after the UI connection succeeds.

A passing proof needs `result.json` with `"passed": true`, both screenshots, both ARIA snapshots, and a second read-only view. A screenshot alone is not proof. The queue scenario, for example, clicks `Add <player> to local shortlist`, opens the `Queue` tab, and confirms `Remove <player> from queue` without another mutation.

Inspect a trace with:

```bash
pnpm --filter scripts exec playwright show-trace \
  ".agents/skills/verify-fantasy-draft-assistant/artifacts/$RUN_ID/$SCENARIO/trace.zip"
```

## Cleanup

Always clean up, including after a failed drive:

```bash
node .agents/skills/verify-fantasy-draft-assistant/scripts/verify.mjs cleanup "$RUN_ID"
```

Cleanup sends signals only to the recorded process group, waits for it to exit, and removes only `/tmp/fantasy-draft-assistant-verification/$RUN_ID`. It never kills by process name. It preserves the artifact directory and updates `run.json` with cleanup status.

Confirm proof survived cleanup:

```bash
test -s ".agents/skills/verify-fantasy-draft-assistant/artifacts/$RUN_ID/$SCENARIO/result.json"
test -s ".agents/skills/verify-fantasy-draft-assistant/artifacts/$RUN_ID/$SCENARIO/after.png"
```

## Helpers

`scripts/verify.mjs` is the only helper. Invoke it with:

```text
verify.mjs launch <run-id>
verify.mjs doctor <run-id>
verify.mjs drive <run-id> <scenario> [scenario-arguments]
verify.mjs cleanup <run-id>
verify.mjs help
```

`sleeper-provider` requires a Sleeper mock-draft URL and accepts an optional draft slot. All other scenarios take no extra arguments.

Use only run IDs containing letters, digits, dots, underscores, or hyphens. Each run ID is single-use so earlier evidence cannot be confused with a new run.
