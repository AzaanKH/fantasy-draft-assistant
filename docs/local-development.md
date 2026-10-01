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

## Configurable local ports and isolated verification

Normal development uses web port 3000 and API port 3001. Export both settings in the shell to use another pair:

```bash
DRAFT_WEB_PORT=3100 DRAFT_API_PORT=3101 pnpm dev:live
```

`DRAFT_WEB_PORT` controls Vite, the API's default trusted web origin, and the extension's web URL. `DRAFT_API_PORT` controls the API listener, Vite proxy, and extension API URL. Both must be distinct integers from 1 to 65535. `PORT` remains a legacy API fallback when `DRAFT_API_PORT` is absent. Shell variables configure these processes; `.env.local` is not the port configuration mechanism.

Vite still binds to loopback with strict ports and injects the pairing token only after same-origin validation. It forwards the actual web port as the canonical localhost origin. `SYNC_ALLOWED_ORIGINS`, when explicitly supplied, overrides the API default and must include that web origin. There is no wildcard-origin exception for tests.

The extension embeds the selected pair at build time. Its generated manifest host permissions and iframe CSP use the same ports; its runtime validator rejects other ports, non-loopback hosts, HTTPS, credentials, paths, queries, and fragments. Rebuild and reload the extension after changing the pair. Use a separate browser profile for a test extension so stored URLs, tokens, and provider cookies do not conflict with your everyday installation.

Changing ports alone does not isolate data or credentials. Use the verification helper to create a private checkout, independent data/report writes, a fresh `.local/sync-token`, and a disposable browser profile:

```bash
.agents/skills/verify-fantasy-draft-assistant/helpers/control.py start
# Defaults to 3100/3101; leaves your 3000/3001 instance running.
# Optional: start --web-port 3200 --api-port 3201
```

Use the printed run ID for doctor, CLI commands, extension-browser, and stop. Browser localStorage and IndexedDB are isolated by the test origin; reset that origin at scenario start. Cookies and extension storage require the dedicated profile. The helper's CLI always uses its recorded API URL and private pairing file. For a manually launched custom-port app, pass `--server-url http://127.0.0.1:3101` or set `DRAFT_SERVER_URL` in CLI commands. See the [verification skill](../.agents/skills/verify-fantasy-draft-assistant/SKILL.md) for queue, mock, navigation, and extension acceptance checks.

## Web bundle limits

`pnpm measure:web-bundle` checks all JavaScript chunks against a combined
384 KiB gzip budget, CSS against 20 KiB gzip, and the complete build output
against 9 MiB. Deferred chunks still count toward the JavaScript limit.
The build-output limit includes source maps, fonts, and browser data.

The Motion migration raised the JavaScript limit from 200 to 240 KiB and the
build-output limit from 5 to 6 MiB. The measured JavaScript total increased from
about 184 to 227 KiB gzip. Motion's layout engine loads in a separate deferred
chunk; the larger limits account for that code and its source maps.

Metric help adds Radix Tooltip and Popover, with the existing Radix dependencies
updated together to avoid shipping duplicate versions. This brings JavaScript
to about 247 KiB gzip and raises its budget from 240 to 256 KiB. The CSS and
complete build-output budgets were unchanged at that stage.

Recharts 3.10 and Sonner 2.0 bring the total to about 371 KiB gzip, up from
251 KiB. The shared Recharts chunk is about 105 KiB and loads only when a
comparison chart or positional-depth view opens. Sonner replaces the custom
undo toast. The combined JavaScript budget is now 384 KiB, and the output budget
is 9 MiB to include chart source maps. CSS remains capped at 20 KiB.
These are total-output limits; deferred charts are included in the measurement.

Animation wrappers live in `web-app/src/components/motion.tsx`. Motion handles
measured list movement and keyed content transitions. CSS and the Web Animations
API retain the simple expansion, metric, and status effects. Every wrapper
respects reduced-motion preferences and the `data-visual-test` flag used by
the visual fixtures.

Reusable Tooltip and Popover components live in `web-app/src/components/ui/`.
`features/help/MetricHelp.tsx` combines them for metric labels: hover or keyboard
focus shows a short definition; clicking, tapping, Enter, or Space opens the full
explanation. Escape or the close button dismisses it and returns focus. Keep
definitions in `metric-help-content.ts` aligned with the domain glossary; keep
current values and decision reasons visible outside the help panel.

The assistant comparison uses lazy-loaded Recharts point charts in the full
Compare view and `PlayerComparisonMetrics.tsx` for its remaining metrics and
compact summary. Point bars share a zero baseline, including negative value
over replacement. Each chart retains a text equivalent for screen readers.
Return Probability uses a fixed 0–100% scale. Missing estimates display
"Unavailable" without a bar. Ranks and position tiers remain text; the preferred
player comes from the current decision lens, not the longest bar.
The summary's Open comparison action selects the Compare view and moves focus to
the analysis. On desktop, that view places the decision explanation beside the
metrics and uses the available width; narrow screens stack them. Two player
identities sit above the comparison. Change player opens a searchable picker
for name, team, or position, with keyboard access and focus returning to its trigger.

The shared `DraftHeader` displays the current pick and session mode on both pages.
Its `DraftSessionStatus` popover contains team count, rounds, draft format, and
the current recommendation policy, plus mock keeper readiness and Primary League
verification status. League setup opens a dialog with Quick mock and Primary
League paths. Quick mock starts with 12 teams, 15 rounds, full PPR, four-point
passing touchdowns, one FLEX, defense, and no keepers or scoring premiums. Team
count, rounds, reception scoring, and passing touchdowns can be saved locally.
The Primary League path reviews the maintained league preset and offers practice
rules or a connection to verify the real draft. The connection dialog retains all
readiness warnings. Practice settings are labeled separately from provider-verified settings. An amber status
icon indicates setup needs attention. Provider connection status remains a
separate control. The header wraps at narrower widths instead of duplicating
session status or setup banners inside either page.

The roster question loads a Recharts positional-depth chart with available player
counts for every available player in each enabled position. The stack separates
tiers 1, 2, and 3 from later-tier or unranked players so bar lengths match the totals. Drafted players and keeper
reservations are excluded. Tiers remain position-relative. The roster view uses
a wider main column and taller bars, with plain position and need labels. A visible
counts table accompanies the chart, including total availability across all tiers;
it sits beside the chart on wide screens and below it on smaller screens.
Both chart views use current league-adjusted data, resize with their containers,
and respect reduced motion. Missing point estimates are never drawn as zero.
Chart tooltips set the container, label, and item foreground explicitly for both
themes; series colors must not override tooltip text contrast.

`components/notifications.tsx` mounts one themed Sonner stack in the main app and
visual fixtures. Queue changes expose Undo and update the existing notice for the
same player. Connection notifications announce meaningful transitions rather than
polling ticks; stale/reconnecting cycles share one warning. Persistent connection
issues remain in the navbar and connection dialog. League setup saves also confirm
through this stack. Use `toast` from `sonner` for additional notifications.

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
