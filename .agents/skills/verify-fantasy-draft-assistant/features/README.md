# Fantasy Draft Assistant verification map

This directory maps the most important user-facing behavior in the Fantasy Draft Assistant. Read this index first, then follow the feature recipe that matches the task.

## Baseline preconditions

- Start from the repository root with Node 20 or newer, pnpm 9 or newer, and installed workspace dependencies.
- Put a usable `FANTASYPROS_API_KEY` in `.env.local`. The live preflight currently needs API-backed rankings with FantasyPros IDs.
- Launch through `scripts/verify.mjs launch <run-id>`. The helper builds and runs a disposable copy with `pnpm dev:live`.
- Read the isolated web and API URLs from the launch output or `artifacts/<run-id>/run.json`. The helper patches ports only inside the disposable checkout.
- Run `scripts/verify.mjs doctor <run-id>` before the first drive.
- Never drive a process that the run did not start. Never reuse a browser profile with a saved `fantasy-draft-live-sync-v1` connection.

## Driving conventions

- The Playwright verifier uses a fresh context for every scenario.
- Prefer route paths, roles, accessible names, labels, and `aria-pressed` state.
- Treat scenario names and quoted handles as literal.
- The root path redirects to `/draft`. `/assistant` and `/sidepanel` are direct routes.
- Live provider picks are read-only in this product. The verifier submits a provider ID only when `sleeper-provider` receives an explicit Sleeper mock-draft URL for that run.

## Proof and skip reporting

- Capture `before.png` before the user action and `after.png` after the observable result.
- Keep the app header or route identity visible in both screenshots.
- Pair screenshots with `before-aria.yml`, `after-aria.yml`, `action.json`, and `result.json`.
- Confirm changed browser state through another read-only UI view.
- Record console output and failed requests. A warning is evidence, not an automatic failure.
- Report each untested entry point by name. Do not use a direct-route pass to claim the extension side panel or a live provider connection works.
- Preserve artifacts during cleanup.

## Feature entry contract

Each feature file describes one user-visible behavior and has these sections in order:

1. `Sub-features`
2. `How to get to it (user POV)`
3. `Driving it with Playwright verifier`
4. `Gotchas`

## Features

- [Draft Workspace and local queue](draft-workspace.md) covers the board, player pool, root redirect, shortlist action, and Queue confirmation.
- [Live draft connection setup and Sleeper provider rehearsal](live-draft-connection.md) covers the safe dialog boundary and a full read-only connection using an explicitly supplied Sleeper mock-draft URL.
- [Mock draft](mock-draft.md) covers starting an isolated mock and confirming the active mock state.
- [Assistant](assistant.md) covers header navigation, the direct route, decision questions, and return navigation.
- [League roster settings](roster-settings.md) covers editing and rereading roster requirements in one browser session.
- [Draft Companion](draft-companion.md) covers the `/sidepanel` web route and records the Chrome extension as a separate, unverified entry point.
