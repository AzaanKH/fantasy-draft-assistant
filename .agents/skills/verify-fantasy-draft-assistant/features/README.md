# Fantasy Draft Assistant feature map

This map records user paths in the React web app and draft CLI. Start with [the skill](../SKILL.md), launch one private run, set `RUN_ID` and `EVIDENCE` from its output, and require `control.py doctor "$RUN_ID"` to pass before driving. Drive one app run serially, resetting browser state when a recipe requires it. Offline CLI scenarios use fresh private runs. The app uses current provider data, so player names and rankings can change between runs.

## Driving conventions

- Follow the skill's browser-driver selection. The recipes below use `agent-browser --session "$RUN_ID"` syntax; translate them to snapshot locators when using T3 preview. Capture a fresh snapshot before taking a ref, and take a new snapshot after each change.
- Prefer accessible names. When a player name varies with refreshed rankings, read the name from the first snapshot and use the corresponding button or the documented stable `aria-label` pattern.
- Keep a feature's entry points separate. A working Queue tab does not prove the Best Pick, Suggestions, or Assistant add buttons.
- Save action and result artifacts under `$EVIDENCE`. A second view must confirm a state change, such as the Queue tab after adding a player.
- Record skips and blockers with the attempted action. Do not treat `/__visual/` fixtures, Vitest, or the deterministic draft rehearsal as browser proof.

## Features

- [Draft board and player pool](draft-board-and-player-pool.md) covers board views, player search, position filters, and draft tools tabs.
- [Queue and shortlist](queue-and-shortlist.md) covers adding a player from each user entry point, viewing the Queue tab, and removing a player. The player pool to Queue path has browser proof.
- [Mock draft](mock-draft.md) covers Start mock, selecting a player, CPU turns, undo, and leaving the mock.
- [Assistant](assistant.md) covers header and recommendation entry points, decision questions, comparisons, and return navigation.
- [Live draft connection](live-draft-connection.md) covers provider selection, slot confirmation, status, and disconnect. It requires a real provider draft to verify sync.
- [CLI and replay](cli-and-replay.md) covers local and connected readiness, sessions, saved connections, roster, player filters, advice, watch, export, offline replay, and machine-readable failures.
