# Assistant

The Assistant explains the current recommendation with decision questions, player context, comparison options, wait risk, and roster fit while sharing state with the Draft Workspace.

## Sub-features

- `assistant.header-entry`: `Assistant` in `Primary navigation` opens `/assistant`.
- `assistant.direct-entry`: `/assistant` loads without a page reload router.
- `assistant.questions`: `Assistant questions` exposes the decision lenses.
- `assistant.return`: `Draft` in `Primary navigation` returns to `/draft`.

## How to get to it (user POV)

- Use `Assistant` in the top navigation from the Draft Workspace.
- Open `http://localhost:3000/assistant` directly.
- Suggestion and analysis controls can also open Assistant with a selected player. That selected-player entry is distinct and is not covered by the baseline scenario.

## Driving it with Playwright verifier

Preconditions: doctor passes and recommendation data has loaded.

- Header entry, direct entry, question panel, and return:

  ```bash
  node .agents/skills/verify-fantasy-draft-assistant/scripts/verify.mjs drive "$RUN_ID" assistant-navigation
  ```

  The scenario enters through the header, requires `/assistant` and `Assistant questions`, loads `/assistant` directly and checks the same panel again, then clicks `Draft` in `Primary navigation` and requires `/draft`.

## Gotchas

- The main heading includes the selected player's current analysis and changes with data. Use `Assistant questions` and the route as stable handles.
- The selected-player entry carries navigation state. Do not mark it verified from a plain `/assistant` route.
- Assistant queue actions share the same browser-memory shortlist as the Draft Workspace.
