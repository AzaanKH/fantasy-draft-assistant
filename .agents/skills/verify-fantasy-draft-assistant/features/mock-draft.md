# Mock draft

The Draft Workspace can start a local mock with keeper reservations, team count, draft slot, randomness, and a deterministic seed.

## Sub-features

- `mock.open-settings`: `Start mock` opens `Start a mock draft`.
- `mock.start`: `Start mock draft` changes the session to `Mock draft` and shows `Mock active`.
- `mock.controls`: the active session exposes `CPU pick`, `To my pick`, and `Settings`.
- `mock.reset-paths`: settings expose Undo, Restart, branch, and Exit mock after picks exist.

## How to get to it (user POV)

- Open `/draft` with confirmed keeper data and use `Start mock` in the top session strip.
- During a mock, use `Settings` to reopen `Mock draft controls`.

## Driving it with Playwright verifier

Preconditions: doctor passes and the `Mock ready` status is present. The scenario uses a fresh browser context, so no previous mock state exists.

- Start and reread the mock state:

  ```bash
  node .agents/skills/verify-fantasy-draft-assistant/scripts/verify.mjs drive "$RUN_ID" mock-start
  ```

  The scenario opens `Start a mock draft`, reads `League teams`, `Your draft slot`, and `Draft seed`, presses `Start mock draft`, requires `Mock draft` and `Mock active`, then opens `Settings` and requires `Mock draft controls` as the second read-only view.

## Gotchas

- `Start mock` is disabled until all keeper assignments load and pass validation.
- Starting the mock changes only the isolated browser store. Closing the Playwright context discards it.
- Team count and draft slot lock after the first selection. This scenario does not make a selection.
- Do not call a preview session Manual Continuity. Manual Continuity belongs to a live draft during provider sync loss.
