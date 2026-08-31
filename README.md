# Fantasy Draft Assistant

Fantasy football draft assistant for ESPN, Yahoo, and Sleeper with:

- a React web app for rankings, recommendations, and roster tracking
- a Chrome extension side panel for draft-room awareness
- a local sync server that stores a canonical draft snapshot and streams updates to clients

## Reference docs

- Canonical product language and the Primary League definition: [CONTEXT.md](CONTEXT.md)
- Architecture decision, Sleeper remains authoritative after Manual Continuity: [docs/adr/0001-sleeper-authority-after-manual-continuity.md](docs/adr/0001-sleeper-authority-after-manual-continuity.md)
- Architecture decision, Core Draft Data blocks live use while Optional Signals degrade: [docs/adr/0002-core-data-blocks-optional-signals-degrade.md](docs/adr/0002-core-data-blocks-optional-signals-degrade.md)
- Primary League rehearsal runbook: [docs/primary-league-rehearsal.md](docs/primary-league-rehearsal.md)
- Provider-confirmed Primary League settings: [data/primary-league-settings.json](data/primary-league-settings.json)
- Recorded real-provider rehearsal operation and status: [data/primary-league-rehearsal.json](data/primary-league-rehearsal.json)
- Latest deterministic rehearsal report: [data/primary-league-deterministic-rehearsal-report.json](data/primary-league-deterministic-rehearsal-report.json)
- Latest release-gate report: [data/primary-league-release-gate-report.json](data/primary-league-release-gate-report.json)
- Data strategy and source decisions: [docs/data-strategy.md](docs/data-strategy.md)
- Draft approach: [docs/draft-approach.md](docs/draft-approach.md)
- Data refresh policy: [docs/data-refresh.md](docs/data-refresh.md)
- Generated draft prep report: [docs/draft-prep-report.md](docs/draft-prep-report.md)
- Local DuckDB modeling workspace: [docs/modeling-duckdb.md](docs/modeling-duckdb.md)

Use `docs/data-strategy.md` as the current source of truth for:

- source selection
- why `nflreadpy` / `nflverse` is the historical-modeling base
- why FantasyPros is the current expert/projection source
- why team environment should be derived data
- why prediction and recommendation should stay separate

## Current Primary League

The current acceptance profile is the 2026 `Ummati Official` league on Sleeper.
Sleeper settings confirmed on August 25, 2026 define a 10-team, 14-round keeper
draft with 140 total slots, including 10 confirmed keepers. Each roster has 14
players: 1 QB, 2 RB, 2 WR, 1 TE, 2 FLEX, 1 K, and 5 bench spots. There is no
defense slot. Scoring is full PPR with a 0.5-point tight-end reception premium
and 0.2 points per rushing attempt.

The deterministic Primary League rehearsal passed on August 25, 2026. The
real-provider rehearsal is still scheduled, so the release gate and feature
freeze remain pending. The linked settings, operation record, and reports above
are the status sources when this summary becomes stale.

## Current Architecture

### Web app

- Path: `web-app/`
- Stack: React, TypeScript, TanStack Query, Zustand, Vite
- Purpose: show available players, value signals, roster state, and live draft sync status

### Shared package

- Path: `shared/`
- Purpose: shared domain types and sync engine
- Includes:
  - player/draft/team environment types
  - `DraftSyncEngine`
  - provider-neutral draft metadata and pick events
  - provider response and browser-snapshot validators and normalizers

### Server

- Path: `server/`
- Purpose: provider-neutral canonical draft sync service
- Behavior:
  - routes a draft session to the appropriate provider adapter or browser feed
  - initializes Yahoo from public settings/player data and polls the complete draft-results snapshot
  - polls Sleeper draft metadata and picks
  - accepts sanitized, event-driven ESPN snapshots from the extension
  - stores last known draft snapshot in memory
  - normalizes picks into canonical events
  - serves snapshot and streams updates over SSE

### Extension

- Path: `extension/`
- Purpose: side panel UX and draft-room context
- Behavior:
  - detects whether the current ESPN, Yahoo, or Sleeper tab is a draft room
  - extracts the provider and league/draft ID from the page URL
  - observes ESPN's existing WebSocket/SSE connection without opening another one
  - strips account identifiers and authentication data before publishing ESPN state
  - side panel connects to the local sync server for canonical snapshot data

## Sync Flow

1. Open an ESPN, Yahoo, or Sleeper draft tab.
2. The extension content script detects the provider and extracts the league/draft ID.
3. The extension background stores that connection descriptor.
4. The side panel connects to the provider-qualified local sync route.
5. Yahoo/Sleeper are polled by the server; ESPN pushes sanitized snapshots from the extension.
6. The web app and extension render the same draft state from the same sync source.

## Requirements

- Node 20+
- pnpm 9+
- Chrome or Chromium for extension testing

## Install

From the repo root:

```bash
pnpm install
```

## Environment

For local API credentials, use a repo-root `.env.local`.

Example:

```bash
cp .env.example .env.local
```

Then set:

```bash
FANTASYPROS_API_KEY=your_key_here
```

The sync server permits configured web origins and unpacked Chrome-extension
origins. It listens only on `127.0.0.1` by default.

## Local Development

Run everything:

```bash
pnpm dev
```

`pnpm dev` reports stale data but does not refresh JSON artifacts automatically.
Use explicit refresh commands so ordinary development does not make network
requests or rewrite tracked snapshots.

That starts:

- `shared` build watcher
- `web-app` dev server on `http://localhost:3000`
- `server` dev server on `http://localhost:3001`
- `extension` build watcher

You can still run pieces separately:

```bash
pnpm dev:shared
pnpm dev:web
pnpm dev:server
pnpm dev:extension
```

On draft day, start through the live preflight:

```bash
pnpm dev:live
```

This refreshes the Sleeper player directory and FantasyPros rankings, rebuilds
the canonical player identities, validates the local Core Draft Data, and then
updates the draft prep report before starting the app. Report generation is
non-blocking because it also reads Optional Signals. Connect the Primary League
draft after startup so the app can verify its live scoring and roster settings.

Refresh the cached FantasyPros snapshot manually:

```bash
pnpm refresh:fantasypros
```

Import the FanDuel and DraftKings PDF snapshots:

```bash
pnpm import:sportsbook
```

The sportsbook importer writes `data/sportsbook-snapshot.json`. Over/under
markets feed a confidence-weighted adjustment to the FantasyPros component-stat
projection; milestone prices remain separate raw implied-probability signals.

Refresh the daily draft-week inputs:

```bash
pnpm refresh:daily
```

Prepare all draft artifacts, run the baseline backtest, and generate the prep
report:

```bash
pnpm prepare:draft
```

`pnpm prepare:draft` refreshes daily inputs, rebuilds the local DuckDB dataset
and survival model, runs the baseline backtest, and rewrites the draft prep
report.

During the FantasyPros refresh step, the script:

- tries the FantasyPros API when `FANTASYPROS_API_KEY` is present
- falls back to the local ECR snapshot when the API request fails
- rewrites `data/fantasypros-snapshot.json`
- fetches consensus PPR ADP separately from expert consensus rankings

The daily refresh also rebuilds `data/player-identity.json`. `pnpm prepare:draft`
finishes with strict freshness and quality validation; required failures stop the
command and are recorded in `data/data-quality-report.json`.

The current live API integration uses the public FantasyPros endpoints under:

```text
https://api.fantasypros.com/public/v2/json/nfl/...
```

Before live drafting, run `pnpm draft:readiness`. It writes
`data/draft-readiness-report.json`, blocks only on invalid Core Draft Data
(trusted rankings, canonical player identities, Primary League settings, or
confirmed keeper supply), and reports experimental predictions, contract
context, and sportsbook context as non-blocking Optional Signal degradation.

Run `pnpm draft:rehearsal` for the deterministic 140-pick Primary League
outage and reconciliation scenario. Run `pnpm draft:release-gate` to record
build, type-check, lint, unit, integration, data-quality, and product-rehearsal
results separately. The real-provider steps and feature-freeze rule are in
[`docs/primary-league-rehearsal.md`](docs/primary-league-rehearsal.md).

Force the old scrape/manual path:

```bash
pnpm refresh:fantasypros:manual
```

## Local Modeling With DuckDB

The prediction/modeling workspace is local and embedded. It uses DuckDB plus Parquet under `data/model/`; no database server or Docker container is required.

```bash
pnpm --filter scripts model:duckdb:init
pnpm --filter scripts model:profile
pnpm --filter scripts model:dataset
```

See [docs/modeling-duckdb.md](docs/modeling-duckdb.md) for the layout and query examples.

## Chrome Extension Setup

1. Open `chrome://extensions`
2. Enable Developer Mode
3. Load the unpacked extension from:

```text
extension/dist
```

4. After code changes, click `Reload` on the unpacked extension

### Historical ESPN 14-team profile

The extension retains a fixed profile from the completed 2026 ESPN integration
work for the `Brosindifferentareacodes` league (`1652783544`). This 14-team,
snake, full-PPR, no-keeper profile is historical. It is not the Sleeper Primary
League and does not define current acceptance, rehearsal, or release-gate
criteria. Its rosters had 17 spots: 1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX, 1 K, 1
D/ST, and 8 bench.

Historical signed-in draft-room URL:

```text
https://fantasy.espn.com/football/draft?leagueId=1652783544&seasonId=2026&teamId=12
```

ESPN randomizes the draft order one hour before the draft. The extension reads
the assigned draft slot from the live room; do not treat ESPN team ID `12` as
draft slot 12.

## Important Extension Caveat

After reloading the extension, refresh the active provider draft tab. This is
required for ESPN because its observer must run before ESPN opens the live draft
connection.

Why:

- Chrome often does not reinject the updated content script into tabs that were already open
- the extension learns the current provider and draft ID from the content script
- if the Sleeper tab is not refreshed, the side panel/background may still show the previous draft state

### When to refresh the provider page

Refresh the ESPN, Yahoo, or Sleeper draft page when:

- you reloaded the extension in `chrome://extensions`
- you started a brand-new draft
- you switched from one draft tab to another and the side panel still shows the old draft

If the extension appears stuck on an old draft:

1. reload the extension
2. refresh the actual Sleeper draft tab
3. close and reopen the side panel

## Using the Web App

1. Open `http://localhost:3000`
2. Click `Connect draft`
3. Paste the draft URL or draft ID
4. Set your draft position
5. The app will connect to the local sync server and track the live draft

### Using ESPN

1. Start the local server and web app with `pnpm dev`.
2. Reload `extension/dist` from `chrome://extensions` after rebuilding.
3. Log into ESPN normally and enter the live draft application.
4. Refresh the ESPN draft tab once so the page-world observer starts before the
   draft connection.
5. Open the extension side panel and confirm the detected draft position.
6. Click **Open Full Draft Board**.

The extension never asks for or publishes ESPN passwords, cookies, draft
security tokens, member IDs, or raw socket initialization payloads.

## API Endpoints

Server base URL:

```text
http://localhost:3001
```

Endpoints:

- `GET /api/health`
- `GET /api/sync/:provider/drafts/:draftId`
- `POST /api/sync/:provider/drafts/:draftId/refresh`
- `GET /api/sync/:provider/drafts/:draftId/events`
- `POST /api/sync/espn/drafts/:draftId/snapshot` (extension only)
- `GET /api/sync/drafts/:draftId`
- `POST /api/sync/drafts/:draftId/refresh`
- `GET /api/sync/drafts/:draftId/events`

`provider` is `espn`, `yahoo`, or `sleeper`. The unqualified routes remain as
backward-compatible Sleeper aliases.

## Polling Behavior

The local sync server polls active provider sessions every `1000ms`. Sleeper
uses two requests per poll. Yahoo loads settings and the player list once, then
uses one draft-results request per poll.

ESPN is event-driven and is not polled. Its authenticated draft connection stays
inside the ESPN tab; the extension publishes only normalized draft metadata and
picks to the local server.

This was chosen because Sleeper’s public guidance says, as a general rule, stay under `1000 API calls per minute`. One local draft session currently makes about:

- `2 requests / second`
- about `120 requests / minute`

That remains below the published guidance for normal single-user local use.

Source:

- https://docs.sleeper.com/

## Testing

### Typecheck

```bash
pnpm --filter @fantasy-draft/shared typecheck
pnpm --filter server typecheck
pnpm --filter web-app typecheck
pnpm --filter extension typecheck
```

### Server tests

```bash
pnpm --filter server test
```

This covers:

- sync engine unit tests
  - mock ESPN, Yahoo, and Sleeper server integration tests

### Manual server checks

```bash
curl http://localhost:3001/api/health
curl http://localhost:3001/api/sync/drafts/YOUR_DRAFT_ID
curl http://localhost:3001/api/sync/yahoo/drafts/YOUR_YAHOO_LEAGUE_ID
```

### Manual end-to-end test

1. Run `pnpm dev`
2. Reload the unpacked extension in Chrome
3. Refresh the actual ESPN, Yahoo, or Sleeper draft page
4. Open the side panel
5. Open `http://localhost:3000`
6. Connect the same draft ID in the web app
7. Verify both the extension and app move with the same draft

## Current Status

Implemented:

- provider-neutral local sync server
- unauthenticated Yahoo public-read adapter
- Sleeper public API adapter
- ESPN page-world WebSocket/SSE observer and sanitized browser-ingest route
- canonical `DraftSyncEngine`
- SSE streaming to clients
- web app consuming server sync instead of polling Sleeper directly
- extension side panel consuming server-backed canonical snapshot
- mock fixture-based server tests
- cached FantasyPros snapshot provider
- real FantasyPros API-backed snapshot refresh
- manual `pnpm refresh:fantasypros:manual` snapshot refresh flow
- recommendation sub-scores and clearer ECR vs consensus-ADP deltas in the UI
- derived `team-environment.json` pipeline backed by nflverse completed-season data
- prediction layer built on historical nflverse production, snap share, Next Gen Stats, and ffopportunity data
- backtest-generated recommendation policy that keeps failed models out of live suggestions
- nflverse/OverTheCap contract context, policy-disabled as a recommendation boost until validated

Not yet implemented:

- automated browser-level extension integration tests

## Known Limitations

- server snapshot storage is currently in-memory only
- extension URL detection still requires the provider draft tab to load its content script
- Yahoo public-read endpoints are undocumented and may change; private leagues may require a later OAuth adapter
- ESPN's draft protocol and React store are private implementation details and may require maintenance after ESPN site updates
- after reloading the extension, the provider draft page usually must be refreshed
- multi-draft or multi-user coordination is not implemented
