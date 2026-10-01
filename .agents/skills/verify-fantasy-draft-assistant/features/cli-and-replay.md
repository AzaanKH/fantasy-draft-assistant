# CLI and replay

The CLI reads canonical provider snapshots, reconstructs a roster, returns draft advice, and exports sessions for offline replay. It does not submit provider picks or read browser-local queues and mock drafts.

## Source entry points

`cli/src/arguments.ts` defines commands and precedence. `run.ts` dispatches them and imports the web app's decision and Assistant calculations. `context.ts` reconstructs picks, keepers, turns, and readiness. `connections.ts` saves defaults; `client.ts` pairs with the server and reads snapshots and streams. `archive.ts` validates exports and reconstructs recorded picks; `roster.ts` calculates roster totals. See also [CLI documentation](../../../../docs/cli.md).

## Preconditions and isolation

Set `CONTROL`, `RUN_ID`, and `EVIDENCE` as described in the skill. Every command below uses `"$CONTROL" cli "$RUN_ID" --` as its prefix. The helper runs doctor and invokes the built executable in the private checkout. Save stdout, stderr, and the exit code for each drive. Do not pipe JSON through pnpm when asserting exact exit codes.

Local readiness needs only an offline run. Connected commands need an app run and a real provider draft supplied for verification. Set `SESSION` to `provider:draftId`, and `SLOT` to the user's one-based slot. Browser slot selection is not stored on the server. ESPN additionally needs a paired extension observing an open, signed-in provider draft tab. Do not invent a provider ID to claim connected coverage.

Advice requires healthy sync, resolved provider players, a snake draft, a slot, and current Core Draft Data meeting Primary League requirements. A browser Quick Mock does not establish those prerequisites. Replay requires a valid exported archive. If an archive is unavailable, attempt the export route and name the missing provider prerequisite. Fixture archives may test executable behavior, but label them as fixtures.

## Local and connected commands

- `cli-help`: Run `--help`. Require all commands listed in `arguments.ts` and exit 0.
- `cli-local-readiness`: In a fresh offline run, run `readiness --json`. Require `data.scope` equal to `local-data` and `readyForAdvice: null`. Exit 3 with actionable core blockers is valid when current inputs are stale or incomplete. The command must not rewrite data reports. Local readiness does not prove provider settings.
- `cli-sessions`: In an app run, run `sessions --json` before and after connecting. This lists retained server sessions and saved slots without refreshing providers or extending session lifetime. An empty list is valid; saved preferences can outlive server sessions.
- `cli-connect`: Run `connect "$SESSION" --slot "$SLOT" --json`, then `status --json` and `roster --json` without session flags. Require matching session and slot. Inspect the private `.local/cli-connections.json` for saved defaults and private permissions, without exposing credentials. Repeat with a supported provider URL when URL parsing changed. A failed connection must leave saved defaults unchanged. ESPN may return exit 0 with `connected: false` and `waitingForObservation: true`; this proves only saved intent.
- `cli-status-roster`: Run `status --session "$SESSION" --slot "$SLOT" --json` and `roster --session "$SESSION" --slot "$SLOT" --json`. Compare current pick, next turn, confirmed picks, keeper reservations, unresolved picks, and remaining selections with the matching provider/browser state. Status without any saved or explicit slot returns null roster and next turn; roster and advice require a slot.
- `cli-connected-readiness`: Run `readiness --session "$SESSION" --json`. Inspect `readyForAdvice`, provider settings, keeper resolution, sync, and corrective actions. Blocked readiness exits 3. Never edit timestamps or confirmations to make a live session appear ready.
- `cli-players`: Run `players --session "$SESSION" --available --position WR --limit 5 --json`. Use returned canonical IDs for `--search`, comparison, and waiting commands. Verify filters, counts, and keeper/drafted exclusion. Unresolved picks must mark availability `unverified`. CLI players use ECR order, do not offer FLEX, and may differ from the browser's selected-lens ordering.
- `cli-advice`: Run `recommend --session "$SESSION" --slot "$SLOT" --lens best-pick --limit 5 --json`, then repeat with `best-player`. Choose two eligible canonical IDs from returned candidates for `compare ID_A ID_B --session "$SESSION" --slot "$SLOT" --json` and `wait ID_A --session "$SESSION" --slot "$SLOT" --json`. Check explanation, preferred player, roster needs, and waiting metrics. Return Probability is 0 to 1 or null; next-pick alternative can be null. Match session, slot, lens, pick state, data, and keepers before comparing to Assistant. A core blocker must prevent advice even when status and player search work.

## Watch and export

- `cli-watch`: Run `watch --session "$SESSION" --format ndjson` as a tracked foreground job with stdout and stderr saved under `$EVIDENCE`. Stop with Ctrl-C after a snapshot and subsequent event, with a 30-second bound for a quiet draft. Check schema version 1, session, increasing process-local sequence, and event types. Observe a real provider advancement before claiming live pick coverage. Snapshot-bearing events are authoritative, including corrected or removed picks. Reconnect may repeat picks; do not append blindly. Check reconnect behavior only when the change affects streaming. After stopping, require the process to exit and the server subscriber count to return to baseline; do not leave a watcher running through teardown.
- `cli-export`: Run `export --session "$SESSION" --slot "$SLOT" --out "$EVIDENCE/session.json" --json`. Require a private archive with snapshot, players, policy, model, keepers, readiness, and capture time. Export can preserve blocked readiness or unhealthy sync. Run the same export again without `--force`; require exit 2 and unchanged archive. Use `--force` only on this run's disposable export when testing replacement.

## Offline replay

After exporting and stopping the app run, start a fresh `start --offline` run and set its `RUN_ID` and `EVIDENCE`. Set `ARCHIVE` to the absolute path of the retained export. The server, pairing file, and saved connection must not be needed. Do not confuse the earlier evidence path with the new one.

```bash
"$CONTROL" cli "$RUN_ID" -- replay "$ARCHIVE" --json
"$CONTROL" cli "$RUN_ID" -- replay "$ARCHIVE" --pick 1 --json
"$CONTROL" cli "$RUN_ID" -- replay "$ARCHIVE" --format ndjson
"$CONTROL" cli "$RUN_ID" -- status --replay "$ARCHIVE" --json
"$CONTROL" cli "$RUN_ID" -- readiness --replay "$ARCHIVE" --json
"$CONTROL" cli "$RUN_ID" -- roster --replay "$ARCHIVE" --json
"$CONTROL" cli "$RUN_ID" -- players --replay "$ARCHIVE" --pick 1 --available --json
"$CONTROL" cli "$RUN_ID" -- recommend --replay "$ARCHIVE" --pick 1 --limit 5 --json
```

- `cli-replay`: Require `source: "replay"` and capture time. Compare captured state with export, then verify `--pick N` removes ordinary picks at or after N while retaining known keepers and reservations. N cannot exceed the captured current pick. Replay NDJSON emits a finite sequence and exits; `--pick N --format ndjson` emits one snapshot.
- `cli-replay-advice`: Use two eligible IDs from replay recommendations for `compare ID_A ID_B --replay "$ARCHIVE" --pick 1 --json` and `wait ID_A --replay "$ARCHIVE" --pick 1 --json`. Use the exported slot or an explicit `--slot`. Readiness and sync are evaluated at capture time using installed calculation code. Recorded blockers must still block advice; replay cannot recover overwritten corrections or outages.
- `cli-errors`: Require one newline-terminated JSON envelope with `schemaVersion: 1`, command, and either data or error. Check invalid slot or unsupported option, missing archive, and out-of-range replay pick. Exact executable exits are 0 success, 1 operational failure, 2 invalid input, and 3 readiness/unusable-advice state. An exit 3 readiness report contains data, not necessarily an error. Do not classify all advice failures as 3; unsupported draft types are operational errors.

The helper intentionally rejects connected options in offline mode before calling the CLI. Test CLI argument conflicts and environment-precedence behavior through the fixture suite, or in an app run, rather than mistaking a helper error for a product JSON error.

## Coverage boundaries and teardown

The CLI supplements browser checks for player data, connected state, and advice. Browser controls, shortlist, mock mutations, settings profiles, route navigation, and extension observation remain separate checks. Mark missing provider and archive prerequisites `verified-unreachable` with the attempted command. A blocked app launch means browser coverage is blocked, not passed by replay.

Stop every watcher, run doctor after failures, stop each private run, and confirm JSON, NDJSON, logs, and archives remain at their recorded evidence paths. `pnpm --filter @fantasy-draft/cli test` covers fixture HTTP, streams, argument precedence, and archive edge cases; it does not prove live providers or browser behavior.
