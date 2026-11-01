# Mock draft

A drafter can practice in the local room, make their own picks while CPU teams draft automatically, and pause, undo, branch, restart, or exit without sending picks to a provider.

## Sub-features

- `mock-start`: Open setup and start a mock with the active league profile's keepers.
- `mock-pick`: Draft an available player on the user's turn.
- `mock-auto`: CPU teams draft automatically until the user's turn, including while another route is open.
- `mock-cpu`: Pause auto-advance and step one CPU pick at a time.
- `mock-recovery`: Undo, branch, restart, or exit the mock.

## How to get to it (user POV)

- Open `/draft` and choose `Start mock` at the top of the board.
- In the `Start a mock draft` dialog, review `League teams`, `Your draft slot`, `Randomness · N%`, `Draft seed` (with `New seed`), and `CPU pick speed` (`Watch`, `Fast`, or `Instant`), then choose `Start mock draft`.
- Once active, the board toolbar shows `Pause` and `Settings`. While paused it shows `Resume` and `CPU pick`.
- Use `Draft <name>` in the player pool or the Queue tab on the user's turn.
- `Settings` opens `Mock draft controls`, with the setup fields plus `Undo`, `Restart`, `Branch at overall pick` with `Create branch`, `Exit mock`, and `Return to board`.

## Driving it with agent-browser

Preconditions: `control.py doctor "$RUN_ID"` passes. Record the active league profile and mock keeper readiness from the `Draft status` popover. Quick mock has no keepers; Primary League practice requires its validated keeper list. Do not force the start button when keeper validation disables it. Record the team count, slot, randomness, seed, and speed before starting.

- `mock-start`: Click `Start mock`; `snapshot -i` must show dialog `Start a mock draft` and the fields above. Choose a speed, then click the fresh `Start mock draft` ref. Require the toolbar to show `Pause` and `Settings`.
- `mock-auto`: Right after starting, require the board's turn status to reach `Your turn · R.PP` for the recorded slot without any clicks; CPU and keeper slots fill on their own. After a user pick, require it to advance to the user's next turn. To check across routes, click `Resume` if paused, open `Assistant` from the header immediately, wait a few seconds, return with `Draft workspace`, and require the turn status to have advanced to the user's turn.
- `mock-pick`: On the user's turn, open the player pool (the `Players` tab below 80rem) and click an enabled `Draft <name>` button. Require the player on the board, then open `Roster` as a second view and require the player there with the count increased (for example `Roster1 / 15`).
- `mock-cpu`: Click `Pause` and require `Resume` and `CPU pick`. `CPU pick` is disabled on the user's turn. On a CPU turn, click it once and require the overall pick to advance by exactly one (for example `Pick 1.08` to `Pick 1.09`).
- `mock-recovery`: Open `Settings`; the dialog's status reads `Your selection · …` or `CPU selection · R.PP · overall #N`. Click `Undo` and require the previous pick to disappear and the mock to pause. `Branch at overall pick` is capped at the current pick; set it to an earlier pick after a user pick, click `Create branch`, and require later picks to disappear while the user's earlier picks and keeper reservations remain and the mock stays paused. Click `Restart` and require pick 1.01 with an empty roster; after closing with `Return to board`, auto-advance resumes. `Exit mock` closes the dialog and brings `Start mock` back.

## Gotchas

- `To my pick` no longer exists. CPU picks run automatically at the selected speed; `CPU pick` is a manual single step that appears only while paused.
- Auto-advance holds while the `Settings` dialog is open, so the board will not move until you close it.
- `Undo` and `Create branch` pause the mock. Nothing advances until `Resume`, `CPU pick`, or the user's own pick, which clears the pause.
- Keeper supply depends on the active league profile. Record its count on each run; do not require the Primary League's keepers in Quick mock.
- Player and CPU picks mutate only the private copied app and isolated browser session. Never treat them as live provider picks.
- The user's turn depends on the selected draft slot. Check the turn status before expecting `Draft` to enable.

## CLI cross-check

The CLI reads provider snapshots and archives, not the browser mock store. It cannot start a mock, make or undo picks, run CPU turns, branch, restart, or inspect this mock roster. Offline replay reconstructs recorded provider history and is separate coverage, not proof of mock recovery. See [CLI and replay](cli-and-replay.md) for commands and evidence requirements.
