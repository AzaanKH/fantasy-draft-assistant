# Local development

Run commands from the repository root with Node 22.12+ and pnpm 9.15.0.

| Command | Purpose |
| --- | --- |
| `pnpm dev:live` | Refresh and validate core inputs, then start the web app, server, and extension watchers. |
| `pnpm dev` | Start with cached data after local freshness, quality, and port checks. |
| `pnpm build` | Build all packages, including `web-app/dist` and `extension/dist`. |
| `pnpm test` | Run the extension, web app, server, and script test suites with local fixtures and mocks. |
| `pnpm verify` | Run type checks, lint, tests, and builds. |
| `pnpm audit:security` | Check installed dependencies for advisories of moderate severity or higher. Requires network access. |
| `pnpm measure:web-bundle` | Build the web app and check its output size and static data policy. |
| `pnpm draft:readiness` | Check whether the cached inputs meet live draft requirements. |
| `pnpm draft:rehearsal` | Run the deterministic Primary League draft and outage rehearsal. |
| `pnpm draft:release-gate` | Evaluate code, data, bundle, and recorded provider rehearsal evidence. |
| `pnpm experiment:primary-league` | Compare Primary League draft strategies against deterministic scenarios. |

For an affected test, use `pnpm --filter <workspace> test <test-file>`.
Test workspaces are `web-app`, `server`, `extension`, and `scripts`.
Build shared types first with `pnpm --filter @fantasy-draft/shared build`
when shared code changes or its build output is missing.

## README screenshots

The README images are browser captures of development-only visual fixtures.
They use fictional players and a fixed draft state, so they do not depend on
provider credentials or show a real league's activity.

After starting the development app, capture these routes at 1440 × 960 pixels
with a device scale factor of 1. Wait for `window.__VISUAL_READY__ === true`
and the document fonts before capturing.

| Image | Route |
| --- | --- |
| `docs/images/draft-workspace.png` | `/__visual/mobile/draft` |
| `docs/images/assistant.png` | `/__visual/assistant?state=wait` |

The draft fixture route also works at desktop widths despite its name.
Production builds return "Not found" for `/__visual/` routes.

## Local API security

The server requires a local pairing token for every protected API request.
`GET /api/health` and allowed `OPTIONS` preflight requests bypass authentication.
State-reading and mutating routes require `X-Sync-Token`, including native
EventSource connections. Vite adds this header only after validating same-origin
browser requests. Both services bind to loopback. The token stays in the ignored
`.local/sync-token` file with owner-only permissions; the extension stores its
copy in storage restricted to trusted extension contexts.

To revoke existing pairings, stop both services, delete `.local/sync-token`,
restart, and run `pnpm sync:pair` to pair again. Advanced clients can export a
random base64url `SYNC_REQUEST_TOKEN` (43–128 characters) to both processes and
send it as `X-Sync-Token`. These server settings must be exported in the shell;
putting them in `.env.local` does not configure the server.

Snapshots support 2–32 teams, 1–40 rounds, and at most 1,280 picks. ESPN
observations more than five minutes from server time are rejected; older
observations return HTTP 409. An authenticated POST to
`/api/sync/espn/drafts/<draftId>/reset` clears that local session so the next
observation can establish it again. It does not change the provider draft.

The local service limits retained sessions to 16, evicts idle sessions after ten
minutes, and admits up to 32 streams (eight per draft), 64 connections, and 300
requests per minute. Slow streams disconnect; clients can reconnect. Shadow logs
retain one 5 MiB current file and one archive with a bounded deduplication index.
