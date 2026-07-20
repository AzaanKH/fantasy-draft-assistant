# Fantasy Draft Assistant

Fantasy football draft assistant for Sleeper with:

- a React web app for rankings, recommendations, and roster tracking
- a Chrome extension side panel for draft-room awareness
- a local sync server that polls Sleeper, stores a canonical draft snapshot, and streams updates to clients

## Reference Docs

- Data strategy and source decisions: [docs/data-strategy.md](docs/data-strategy.md)
- Draft approach: [docs/draft-approach.md](docs/draft-approach.md)
- Data refresh policy: [docs/data-refresh.md](docs/data-refresh.md)
- Generated draft prep report: [docs/draft-prep-report.md](docs/draft-prep-report.md)
- Local DuckDB modeling workspace: [docs/modeling-duckdb.md](docs/modeling-duckdb.md)
- Original technical spec: [fantasy-draft-assistant-spec.md](fantasy-draft-assistant-spec.md)

Use `docs/data-strategy.md` as the current source of truth for:

- source selection
- why `nflreadpy` / `nflverse` is the historical-modeling base
- why FantasyPros is the current expert/projection source
- why team environment should be derived data
- why prediction and recommendation should stay separate

## Current Architecture

### Web app

- Path: `web-app/`
- Stack: React, TypeScript, TanStack Query, Zustand, Vite
- Purpose: show available players, value signals, roster state, and Sleeper sync status

### Shared package

- Path: `shared/`
- Purpose: shared domain types and sync engine
- Includes:
  - player/draft/team environment types
  - `DraftSyncEngine`
  - normalized Sleeper draft pick types

### Server

- Path: `server/`
- Purpose: canonical Sleeper sync service
- Behavior:
  - polls Sleeper draft endpoints
  - stores last known draft snapshot in memory
  - normalizes picks into canonical events
  - serves snapshot and streams updates over SSE

### Extension

- Path: `extension/`
- Purpose: side panel UX and draft-room context
- Behavior:
  - detects whether the current Sleeper tab is a draft room
  - extracts `draftId` from the page URL
  - side panel connects to the local sync server for canonical snapshot data

## Sync Flow

1. Open a Sleeper draft tab.
2. The extension content script detects the draft room and extracts the `draftId`.
3. The extension background stores that `draftId`.
4. The side panel connects to the local sync server using that `draftId`.
5. The local server polls Sleeper and emits canonical snapshot updates.
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

The sync server permits only configured browser origins. The web app default is
already included; add your unpacked extension's exact `chrome-extension://...`
origin to `SYNC_ALLOWED_ORIGINS` when using the side panel.

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

Refresh the cached FantasyPros snapshot manually:

```bash
pnpm refresh:fantasypros
```

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

The current live API integration uses the public FantasyPros endpoints under:

```text
https://api.fantasypros.com/public/v2/json/nfl/...
```

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

## Important Sleeper Extension Caveat

After reloading the extension, you must also refresh the active Sleeper draft tab.

Why:

- Chrome often does not reinject the updated content script into tabs that were already open
- the extension learns the current `draftId` from the content script running in the Sleeper page
- if the Sleeper tab is not refreshed, the side panel/background may still show the previous draft state

### When to refresh the Sleeper page

Refresh the Sleeper draft page when:

- you reloaded the extension in `chrome://extensions`
- you started a brand-new draft
- you switched from one draft tab to another and the side panel still shows the old draft

If the extension appears stuck on an old draft:

1. reload the extension
2. refresh the actual Sleeper draft tab
3. close and reopen the side panel

## Using the Web App

1. Open `http://localhost:3000`
2. Click `Connect Sleeper`
3. Paste the draft URL or draft ID
4. Set your draft position
5. The app will connect to the local sync server and track the live draft

## API Endpoints

Server base URL:

```text
http://localhost:3001
```

Endpoints:

- `GET /api/health`
- `GET /api/sync/drafts/:draftId`
- `POST /api/sync/drafts/:draftId/refresh`
- `GET /api/sync/drafts/:draftId/events`

## Polling Behavior

The local sync server currently polls Sleeper every `1000ms` during live sync.

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
- mock Sleeper server integration tests

### Manual server checks

```bash
curl http://localhost:3001/api/health
curl http://localhost:3001/api/sync/drafts/YOUR_DRAFT_ID
```

### Manual end-to-end test

1. Run `pnpm dev`
2. Reload the unpacked extension in Chrome
3. Refresh the actual Sleeper draft page
4. Open the side panel
5. Open `http://localhost:3000`
6. Connect the same draft ID in the web app
7. Verify both the extension and app move with the same draft

## Current Status

Implemented:

- local Sleeper sync server
- canonical `DraftSyncEngine`
- SSE streaming to clients
- web app consuming server sync instead of polling Sleeper directly
- extension side panel consuming server-backed canonical snapshot
- mock fixture-based server tests
- cached FantasyPros snapshot provider
- real FantasyPros API-backed snapshot refresh
- manual `pnpm refresh:fantasypros:manual` snapshot refresh flow
- recommendation sub-scores and clearer FantasyPros vs Sleeper deltas in the UI
- derived `team-environment.json` pipeline backed by nflverse completed-season data
- prediction layer built on historical nflverse and ffopportunity data

Not yet implemented:

- automated browser-level extension integration tests

## Known Limitations

- server snapshot storage is currently in-memory only
- extension still depends on the Sleeper tab content script to provide the current `draftId`
- after reloading the extension, the Sleeper page usually must be refreshed
- multi-draft or multi-user coordination is not implemented
