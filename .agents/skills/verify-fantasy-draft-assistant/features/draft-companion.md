# Draft Companion

The Draft Companion is the narrow decision view used beside a provider draft room. The React implementation is available at `/sidepanel`, and the packaged Chrome extension loads its own side-panel HTML from `extension/dist`.

## Sub-features

- `companion.web-route`: `/sidepanel` shows the compact Fantasy Draft view.
- `companion.navigation`: `Side panel navigation` switches among Draft, Compare, Assistant, and Roster.
- `companion.shared-state`: a provider-qualified query can read the same sync state as the Draft Workspace.
- `companion.chrome-extension`: the unpacked extension detects a provider draft tab and opens the side panel.

## How to get to it (user POV)

- Open `http://localhost:3000/sidepanel` for the narrow web route.
- In Chrome, load `extension/dist` as an unpacked extension, open an ESPN, Yahoo, or Sleeper draft room, refresh that provider tab after an extension reload, and open the extension side panel.

## Driving it with Playwright verifier

Preconditions: doctor passes. The baseline has no provider query and no Chrome extension profile.

- Web route and narrow navigation:

  ```bash
  node .agents/skills/verify-fantasy-draft-assistant/scripts/verify.mjs drive "$RUN_ID" sidepanel-preview
  ```

  The scenario loads `/sidepanel` in a 520-pixel viewport, requires the `Fantasy Draft` heading and `Side panel navigation`, opens `Assistant`, requires the `Assistant` heading, then uses `Return to Draft` and requires `Fantasy Draft` again.

- The unpacked Chrome extension is a separate entry point and is not verified by `sidepanel-preview`. A future extension run must record the Chrome profile, provider tab URL, detected provider and draft ID, extension reload, provider-tab refresh, and side-panel screenshot.

## Gotchas

- The direct route proves the React Draft Companion, not Chrome manifest loading, content-script injection, or the background service worker.
- ESPN requires a signed-in tab and the extension observer must load before ESPN opens its live connection.
- After rebuilding or reloading the extension, refresh the active provider draft page before judging detection or sync.
- Do not reuse a normal Chrome profile for automated proof unless the user explicitly authorizes that signed-in surface.
