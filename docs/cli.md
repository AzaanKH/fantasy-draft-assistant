# Draft CLI

The CLI reads the project's local data and the same canonical provider snapshots
used by the web app. Recommendations, comparisons, and waiting explanations use
the existing draft calculations. It does not submit provider picks.

## Install and run

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm build:cli
pnpm --silent draft --help
```

Use `pnpm --silent draft` in place of `draft` in the examples below. The silent
flag keeps pnpm's script banner out of JSON output. To make the bare `draft`
command available throughout your shell, run `pnpm link --global` from the root.
The command resolves data and the pairing file relative to this checkout, so it
also works from another directory. Rebuild with `pnpm build:cli` after changing
CLI or calculation code. The normal `pnpm build` also builds the CLI.

`readiness` without an explicit, environment, or saved session reads current
local artifacts without rewriting reports. Connected commands need the local
server. Start the app with `pnpm dev:live` and connect through the CLI, web app,
or extension. ESPN requires
the paired extension and an open, signed-in provider draft tab.

## Sessions and your slot

A session is `sleeper:DRAFT_ID`, `yahoo:DRAFT_ID`, or `espn:DRAFT_ID`. A bare
draft ID selects Sleeper. The ID is the one used when connecting the draft in
the app, rather than an invented CLI session ID.

The server does not retain the draft slot selected in the browser. Save a
connection and your one-based slot:

```bash
draft connect sleeper:YOUR_DRAFT_ID --slot 5 --json
draft sessions --json
draft status --json
draft roster --json
```

`connect` also accepts supported provider draft URLs, such as
`https://sleeper.com/draft/nfl/DRAFT_ID`,
`https://football.fantasysports.yahoo.com/draftclient/f1/DRAFT_ID`, or
`https://fantasy.espn.com/football/draft?leagueId=DRAFT_ID`.
It fetches the provider snapshot, then saves the session, slot, and local server
URL in `.local/cli-connections.json`. This private file contains no pairing token
or provider credentials. Failed connections leave it unchanged. When ESPN has
no observations yet, the command saves the intended connection and returns
`connected: false`, `waitingForObservation: true`, and an action to open the
paired draft tab.

Later commands use the active saved session. Flags override environment
variables, which override saved settings. An explicit session selects its own
saved slot and server URL. You can also supply `--slot NUMBER` on each command
or export defaults:

```bash
export DRAFT_SLOT=5
export DRAFT_SESSION=sleeper:YOUR_DRAFT_ID
```

`status` works without a slot and returns `null` for your next turn and roster.
`roster`, `recommend`, `compare`, and `wait` require a slot. The CLI includes future keeper
reservations when reconstructing the roster and filters them from availability.
Provider corrections override conflicting reservations.
Keeper pick numbers follow the connected draft's snake or linear order.

`sessions` lists drafts currently retained in the local server's memory, with
provider, current pick, sync state, last activity, subscriber count, and your
saved slot when available. Listing does not fetch provider data or extend the
session's lifetime. Idle drafts normally expire after ten minutes, and restarting
the server clears the list. Saved connection preferences survive a restart;
run `connect` or a connected command to request the provider snapshot again.

## Commands

| Task | Command | Result |
| --- | --- | --- |
| Discover sessions | `draft sessions --json` | Retained provider sessions, sync state, active connection, and saved slots. |
| Connect a draft | `draft connect SESSION_OR_URL --slot 5 --json` | Validated connection and saved defaults for later commands. |
| Check readiness | `draft readiness --json` | Local core blockers, freshness, saved settings, keeper resolution, and optional degradation. |
| Verify a connected draft | `draft readiness --session SESSION --json` | Provider settings, keeper confirmation, sync blockers, and `readyForAdvice`. |
| Inspect a connected draft | `draft status --session SESSION --json` | Current pick, on-the-clock slot, your next turn, roster, and sync health. |
| Inspect your roster | `draft roster --session SESSION --json` | Player details, confirmed picks, keeper reservations, remaining selections, and roster needs. |
| Search available players | `draft players --session SESSION --position WR --available --json` | Filtered players with stable canonical `id` values. |
| Get advice | `draft recommend --session SESSION --lens best-pick --limit 5 --json` | Ranked candidates, explanations, roster needs, and Best Pick/Best Player divergence. |
| Compare alternatives | `draft compare PLAYER_A PLAYER_B --session SESSION --json` | Quality, roster fit, position tiers, timing, and the preferred alternative. |
| Ask whether to wait | `draft wait PLAYER_ID --session SESSION --json` | Return Probability, Expected Next-Pick Alternative, cost of waiting, and explanations. |
| Follow the draft | `draft watch --session SESSION --format ndjson` | An ongoing stream of provider snapshots, picks, sync changes, and heartbeats. |
| Export a session | `draft export --session SESSION --out FILE --json` | A portable archive of the snapshot, player pool, model, policy, keepers, and readiness evidence. |
| Replay a session | `draft replay FILE --pick 24 --json` | Recorded status, snapshot, readiness, and roster before overall pick 24. |
| Stream recorded picks | `draft replay FILE --format ndjson` | A finite sequence of reconstructed snapshots in pick order. |

`players` also accepts `--search TEXT` and `--limit NUMBER`. Search matches names,
NFL teams, and canonical IDs. Position matching is case-insensitive. Omit
`--available` to include taken players. Pass IDs from the `players` result to
`compare` and `wait`; player names and provider-specific IDs are not substitutes.
IDs normally come from the canonical identity map. If a ranked player has no
canonical or Sleeper join, the CLI uses `fantasypros:SOURCE_ID` so changes to
the player's ECR rank cannot change its ID. A row with no stable identifier
blocks the player pool until identities are refreshed.

The decision lenses are `best-pick` and `best-player`, matching the app. Best
Pick is the default. Best Player preserves ECR ordering. Tiers are relative to
each position. Return Probability is a number from 0 to 1; a missing estimate or
next-pick alternative is `null`.
Waiting advice skips completed picks and keeper reservations when finding your
next selection. If every later turn is occupied, it reports no later selection.

Advice uses the app's current Primary League readiness requirements and supports
snake drafts. Saved local confirmations alone do not establish connected
readiness. Missing provider settings, core blockers, unresolved provider players,
or unhealthy sync prevent advice. Optional signal failures do not prevent it.
Status and player search remain available while core readiness is blocked. If a
provider player cannot resolve, player output marks availability `unverified` and
includes `unresolvedPicks`.

Roster output includes `confirmedCount` for resolved provider picks and
`keeperReservationCount` for keepers not yet confirmed at their reserved pick.
Both contribute to `rosterSize` and `selectionsRemaining`. Each player has a
`source` of `provider` or `keeper-reservation`. Unresolved provider picks for your
slot appear separately, so the displayed totals do not imply they were resolved.

## Export and offline replay

```bash
draft export --out .local/draft-session.json --json
draft replay .local/draft-session.json --json
draft replay .local/draft-session.json --pick 24 --json
draft replay .local/draft-session.json --format ndjson
draft players --replay .local/draft-session.json --pick 24 --available --json
draft recommend --replay .local/draft-session.json --pick 24 --limit 5 --json
```

Export requires a provider snapshot and a structurally valid player pool. It can
capture blocked readiness or unhealthy sync; those failures remain visible and
continue to block replay advice. The single JSON file captures merged player
inputs, league settings, keeper resolution, recommendation policy, survival
model, readiness, and warnings. Files use private permissions, have a 20 MiB
limit, and include no pairing token or provider credentials. Existing files
require `--force` to replace them.

Replay reads only the archive. It needs no local server, pairing file, saved
connection, or current data artifacts. `--replay FILE` works on `readiness`,
`status`, `roster`, `players`, `recommend`, `compare`, and `wait`. These commands
return `source: "replay"` and the export's capture time. The exported slot is the
default; `--slot` or `DRAFT_SLOT` can override it. Live session and server defaults
are ignored, and explicit `--session` or `--server-url` cannot be combined with
replay.

Without `--pick`, replay uses the captured state. `--pick N` reconstructs the
state before overall selection N, removing later ordinary picks while retaining
known keeper picks and reservations. N cannot exceed the exported current pick.
Keeper reservations can advance the next open pick beyond the requested cursor.
Replay evaluates freshness and sync at the capture time, using the installed
calculation code with the captured inputs. Its healthy sync result describes the
recorded snapshot, not the current provider connection.

The archive contains the canonical pick history at export time. Replay cannot
recover intermediate corrections or outages that were replaced before export.
NDJSON replay emits snapshots immediately in pick order and exits; it does not
simulate the original delays. `--pick N --format ndjson` emits one snapshot.
Use `watch` for ongoing live updates.

## JSON and streaming

Successful JSON commands return one newline-terminated object:

```json
{"schemaVersion":1,"command":"status","data":{"session":"sleeper:123"}}
```

This example shows the envelope only. Each command's `data` contains the fields
listed above. Errors use the same version and command with an `error` object:

```json
{"schemaVersion":1,"command":"recommend","error":{"code":"SLOT_REQUIRED","message":"Set --slot NUMBER or DRAFT_SLOT to calculate advice for your roster."}}
```

Readiness blockers include corrective actions. Recommendation failures include
readiness or sync details when available. Without `--json`, finite commands print
the same result with indentation for terminal inspection.

Watch writes one compact JSON object per line. Each line contains
`schemaVersion`, `command`, `session`, a process-local increasing `sequence`,
`receivedAt`, and the event's fields. Event types are `snapshot`, `pick`, `status`,
`heartbeat`, and `reconnecting`. Snapshot-bearing events contain the server's full
canonical provider snapshot. Pick IDs inside watch events retain their provider
namespace; use `players` to obtain canonical recommendation IDs.

Watch reconnects after interrupted or silent streams, emits `reconnecting` with
`retryInMs`, and receives a fresh snapshot on reconnection. Retries back off to
30 seconds. Snapshots are authoritative, including corrected or removed picks.
Do not append each pick event blindly; reconcile by session and pick number.
The stream can repeat a snapshot or pick after reconnecting. Ctrl-C, SIGTERM,
or a closed output pipe stops the stream and releases the connection. Invalid
events and rejected pairing tokens produce a JSON error and exit.

Replay stream lines contain `schemaVersion`, `command`, `session`, `sequence`,
`source: "replay"`, `capturedAt`, `cursorPick`, `type: "snapshot"`, and the
reconstructed provider `snapshot`.

| Exit code | Meaning |
| --- | --- |
| `0` | Successful command, or stream stopped. |
| `1` | Operational error, such as server connection or pairing failure. |
| `2` | Invalid command, option, slot, player ID, or archive; existing export without `--force`. |
| `3` | Blocked readiness or unusable state for advice. |

These are the executable's exit codes. pnpm can normalize a script failure to
exit code `1`; use the bare executable or `node cli/bin/draft.mjs` when scripting
against specific codes.

## Local configuration

| Variable | Purpose |
| --- | --- |
| `DRAFT_SESSION` | Overrides the active saved session; overridden by `--session` or a `connect` target. |
| `DRAFT_SLOT` | Overrides the saved or exported slot; overridden by `--slot`. |
| `DRAFT_SERVER_URL` | Overrides the saved local server URL; overridden by `--server-url`. Without either, defaults to `http://127.0.0.1:3001`. |
| `DRAFT_ROOT` | Alternate project checkout or data root. Defaults to the installed checkout. |
| `SYNC_REQUEST_TOKEN` | Explicit pairing token, matching the server; otherwise reads `.local/sync-token`. |

Server URLs must use HTTP on loopback, with no credentials, path, or query.
The CLI sends the token as `X-Sync-Token`, never prints it, and rejects redirects.
See [local API security](local-development.md#local-api-security) for pairing
and token rotation.

The CLI is covered by fixture-based HTTP and stream tests. Run
`pnpm --filter @fantasy-draft/cli test` for its suite; it also participates in
`pnpm test`, `pnpm typecheck`, `pnpm build`, and `pnpm verify`.
