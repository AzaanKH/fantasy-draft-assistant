# League roster settings

The header's League roster dialog edits the roster requirements used by PickEV, including fixed starters, roster maximums, FLEX starters, and bench spots.

## Sub-features

- `roster.open`: `League roster` opens `Roster requirements`.
- `roster.edit`: labeled number fields update roster requirements.
- `roster.session-persistence`: closing and reopening the dialog shows the edited value.
- `roster.reset`: `Reset defaults` restores the repository defaults.

## How to get to it (user POV)

- Open `/draft` or `/assistant` and use `League roster` in the header.

## Driving it with Playwright verifier

Preconditions: doctor passes and the browser uses a fresh context.

- Edit, reread, and reset the QB starter value:

  ```bash
  node .agents/skills/verify-fantasy-draft-assistant/scripts/verify.mjs drive "$RUN_ID" roster-settings
  ```

  The scenario opens `Roster requirements`, records the current `QB` value, writes a different valid value, closes and reopens the dialog, and requires the edited value. The reopened field is the second read-only view. It then presses `Reset defaults` before the browser closes.

## Gotchas

- The short `QB` label identifies the starter input. `QB roster maximum` is a separate field.
- Raising a starter value can also raise the maximum. The proof changes the starter within the allowed range and records both old and new values.
- Roster settings live in the Zustand browser store. They do not write a server file or provider setting.
