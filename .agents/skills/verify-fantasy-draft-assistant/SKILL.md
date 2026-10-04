---
name: verify-fantasy-draft-assistant
description: Verify Fantasy Draft Assistant through its browser workspace and draft CLI. Use for board, queue, mock, Assistant, provider connection, CLI, and offline replay changes.
---

# Verify Fantasy Draft Assistant

Use this skill to check what a drafter can do in the web app and CLI. Read [the feature map](features/README.md) before choosing a path. The React app at `/draft` and `/assistant` is the primary user surface. The CLI is another user interface for provider sessions and recorded archives. The Chrome extension side panel, provider draft rooms, and local API need separate checks when affected. CLI JSON can corroborate connected data and advice, but it cannot read browser-local queues, mocks, selected players, or settings profiles. Unit tests and the deterministic Primary League rehearsal do not prove that browser controls work.

## Launch

From the repository root, run:

```bash
.agents/skills/verify-fantasy-draft-assistant/helpers/control.py start
```

The command prints a `run_id`, the URL, and the evidence directory. Set `RUN_ID` to that printed ID, `RUN_URL` to the printed URL, and `EVIDENCE` to the printed directory for the commands below. It copies the current checkout, including uncommitted source, into a private temporary directory, excluding `.env` and `.env.local` before installing locked dependencies, building the shared package and CLI with `pnpm build:cli`, and running the documented `pnpm dev:live`. The live preflight refreshes Sleeper and FantasyPros inputs and writes reports only in the copy. The helper removes inherited `FANTASYPROS_API_KEY` from setup and CLI commands and, by default, app startup. The refresh has a documented fallback without this optional key. Only for trusted code, export `FANTASYPROS_API_KEY` and use `start --trusted-credentials` to pass it to the live app run. Never supply credentials when verifying untrusted changes. The copied server creates its own pairing token in `.local/sync-token`. No provider login is needed for the local mock or queue paths.

The everyday app defaults to 3000/3001. Verification defaults to 3100/3101, set together with `DRAFT_WEB_PORT` and `DRAFT_API_PORT`. Override verification with `start --web-port 3200 --api-port 3201`. The helper checks only the requested pair, refuses occupied ports, and never attaches to an existing instance. It waits for `/draft` and `/api/health` to return HTTP 200. The copy keeps the checked-out app's data files, while the printed `browser_profile` is a fresh private directory for the extension browser. The test origin also separates web localStorage and IndexedDB from the everyday app. Ports alone do not isolate cookies or extension storage, so extension checks must use this private profile. If package installation, live refresh, or readiness fails, read `setup.log` or `app.log` in the printed evidence directory. The helper removes a failed copy automatically.

For offline CLI checks, including when another app owns the fixed ports, use:

```bash
.agents/skills/verify-fantasy-draft-assistant/helpers/control.py start --offline
```

This creates a fresh private checkout and builds the CLI without starting a server or refreshing providers. It preserves current data timestamps, so stale-data blockers are valid results. The `.local` pairing file and saved CLI connections are excluded. Use a new offline run for each independent scenario; commands within one replay scenario share its private checkout. An offline run does not satisfy browser or live-provider coverage.

## Doctor

Before the first drive in each run, and after any failed or surprising drive, run this read-only check:

```bash
.agents/skills/verify-fantasy-draft-assistant/helpers/control.py doctor "$RUN_ID"
```

Require every boolean to be `true`. It checks the process group, private checkout and data directory, shared build output, ownership of both recorded ports, web and API readiness, and a token-authenticated read of the copy's keeper data. App mode also checks that its token differs from the everyday checkout and that its browser profile is private. Both modes also check the CLI build and execute its help command. Offline mode checks only the private checkout and builds; it does not probe occupied ports or another server. If it fails, stop this run and inspect its logs. Do not drive a listener that the doctor cannot associate with this run.

## Browser drive

Use T3 Code's collaborative preview when available. Call `preview_status`, then `preview_open` if needed. Use a dedicated run tab, navigate to the printed URL, inspect with `preview_snapshot`, and drive snapshot-provided locators. After doctor proves ownership, reset localStorage, sessionStorage, and any app IndexedDB only on the printed test origin before the first scenario, then reload. Record `RUN_ID` in sessionStorage. Never reset 3000/3001 or another active run. A dedicated tab alone does not isolate storage; the separate test origin provides web storage isolation from your everyday app. Use the private profile for cookie or extension checks. The doctor cannot detect a wedged UI, so reload or reopen the run tab after a surprising browser failure. Save its evidence and close only that tab during cleanup.

If T3 preview tools are absent or explicitly unavailable, use `agent-browser` with this run's ID:

```bash
agent-browser --session "$RUN_ID" open "$RUN_URL"
agent-browser --session "$RUN_ID" snapshot -i
```

Drive with accessible button names from a fresh snapshot. Resnapshot after navigation, dialogs, or tab changes. The draft toolbar has `Start mock`; the board has `Current pick` and `Full board`; the lower `Draft tools` region has `Players`, `Suggestions`, `Queue`, and `Roster` tabs. The header has `Draft workspace` and `Assistant` buttons. `/assistant` and `/sidepanel` are also routes, but `/sidepanel` is a companion layout and is not an extension installation test.

For the proven queue path, the player pool buttons use `Add <player name> to local shortlist`. The Best Pick bar uses `Add <player name> to the local queue`. After an add, open the `Queue` tab and check its own player row. See [queue and shortlist](features/queue-and-shortlist.md) for the exact commands and proof.

## Required browser coverage

Use the real `/draft` and `/assistant` controls with normal refreshed data. Keep one coordinating driver and run these checks serially. A CLI success does not complete a browser row.

| Path | Required action and independent confirmation |
| --- | --- |
| Queue | Add independently from Players, Best Pick, Suggestions, Assistant header, Assistant pool, and positional depth. After each add, confirm the named Queue row, remove it, and exercise toast Undo. Check an empty queue between entry points. |
| Mock | Start with a recorded slot and seed; advance one CPU turn and run to your turn; draft an available player; confirm board and Roster; undo an ordinary pick; branch after several picks; restart and exit. |
| Navigation | Open Assistant from the header, Why this pick, and Ask why. Check the selected player, all four questions, and both return buttons. Confirm pick history and queue survive route changes. |
| Extension | Launch the actual test build in the private profile, pair to the private API, load the side panel, and observe a real provider draft update reaching the private app. Record missing provider login/draft prerequisites separately. |

Use the feature recipes for selectors and capture before/after snapshots, screenshots, visible text, and the selected player's identity. A toast alone is not queue proof, and `/sidepanel` alone is not extension proof.

## Extension browser

The app watcher builds `extension/dist` in the private copy with the same port pair. Its defaults, URL validation, host permissions, and frame CSP follow those ports. A test extension rejects everyday app URLs.

```bash
"$CONTROL" extension-browser "$RUN_ID" --browser-executable "/absolute/path/to/Chromium"
```

Set `CONTROL` to this skill's `helpers/control.py`. Use Chromium or Chrome for Testing with unpacked-extension loading support. The helper launches only this run's build and private profile, records its process, and opens `chrome://extensions/`. Verify Fantasy Draft Assistant is enabled without errors. Do not load the test build into your everyday profile. Follow [live draft connection](features/live-draft-connection.md) for pairing and observation proof. If the collaborative browser cannot drive an installed extension, perform this portion in the launched extension browser and retain its evidence separately; never count web-preview results as extension results.

## CLI drive

Use the skill helper so the executable, data root, saved connection, and token all belong to the private checkout:

```bash
CONTROL=.agents/skills/verify-fantasy-draft-assistant/helpers/control.py
"$CONTROL" cli "$RUN_ID" -- --help
"$CONTROL" cli "$RUN_ID" -- readiness --json > "$EVIDENCE/readiness.json" 2> "$EVIDENCE/readiness.stderr"
CLI_EXIT=$?
printf '%s\n' "$CLI_EXIT" > "$EVIDENCE/readiness.exit"
```

The helper runs doctor before each command and after a nonzero exit. Doctor writes to stderr, leaving stdout as CLI output. It clears inherited `DRAFT_*` and `SYNC_REQUEST_TOKEN`, sets `DRAFT_ROOT` to the private copy and `DRAFT_SERVER_URL` to this run's API port, and invokes `node cli/bin/draft.mjs` to preserve exact exit codes. Supply session and slot explicitly when comparing against the browser. To test saved defaults, run `connect` first inside that same private run. Never use a globally linked `draft` for verification.

Offline runs allow local `readiness`, help, and replay commands. Connected commands require an app run. Use absolute paths for replay input and export output, because the helper runs from the private checkout. Read [CLI and replay](features/cli-and-replay.md) for command coverage, streams, and expected errors. Rebuild after source changes by starting a fresh copy.

## Evidence

Put proof under the printed `EVIDENCE` path, which is `artifacts/verification/<run_id>/` and is ignored by Git. Record the feature file, entry point, action, and result in a short text file. CLI proof includes the arguments, stdout, stderr, and exact exit code. Keep archives and finite NDJSON recordings here too. Label fixture, recorded-provider, and live-provider evidence separately; an archive never proves current sync. Save a browser snapshot before the action, a snapshot after it, and screenshots showing the relevant control and resulting state. For a state change, open a second read-only view such as the Queue tab, then save its snapshot and visible text. A screenshot alone is insufficient if it does not show what changed.

The app's `/__visual/` routes use fictional fixed data for README screenshots. They are useful for layout checks but do not prove the real draft workspace. The browser run here uses real app controls and the app's normal refreshed data. Provider connections need a separate real draft and current settings confirmation; never claim live sync from a local mock.

## Cleanup

After capturing evidence, run:

```bash
.agents/skills/verify-fantasy-draft-assistant/helpers/control.py stop "$RUN_ID"
```

Close a T3 preview run tab separately after saving its evidence. The helper closes this run's `agent-browser` session when installed, closes the recorded extension browser process group, signals only the app process group it started, and removes only its private temporary checkout. It leaves `artifacts/verification/<run_id>/` intact. Confirm the evidence files still exist. Never kill processes by name or clear a shared browser profile.

## Helpers

- `helpers/control.py start` creates the private checkout, installs dependencies, builds the CLI, runs `pnpm dev:live`, and prints the run details.
- `helpers/control.py extension-browser <run_id> --browser-executable <path>` loads the actual test extension in the run's disposable profile.
- `helpers/control.py start --offline` creates and builds a private copy without starting services.
- `helpers/control.py cli <run_id> -- <arguments>` checks the run and executes its CLI with isolated defaults. It preserves command exit codes; helper failures exit 1.
- `helpers/control.py doctor <run_id>` performs the read-only safety and readiness check.
- `helpers/control.py stop <run_id>` closes this run's browser session and removes its process and copy while retaining proof.

The helper requires Python 3, `rsync`, Node 22.18+, and pnpm 9.15.0. App mode also requires `lsof`; browser checks require an available browser driver. Test helper isolation and cleanup with `python3 -m unittest discover -s .agents/skills/verify-fantasy-draft-assistant/helpers -p 'test_*.py'`. Reprove changed helpers with an actual start, doctor, drive, and stop cycle.
