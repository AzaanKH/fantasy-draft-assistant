# Live draft connection setup and Sleeper provider rehearsal

The Draft Workspace accepts Sleeper, ESPN, and Yahoo draft URLs or IDs and explains how each provider supplies read-only draft state.

## Sub-features

- `connection.open-dialog`: `Connect draft` opens `Live draft sync`.
- `connection.provider-choice`: `Draft provider` offers Sleeper, ESPN, and Yahoo.
- `connection.provider-input`: the labeled draft URL or ID input changes with the provider.
- `connection.connected-management`: a connected session exposes status, refresh, and disconnect controls.
- `connection.sleeper-provider-rehearsal`: an explicit Sleeper mock-draft URL connects through the live read-only provider path and yields a canonical snapshot.

## How to get to it (user POV)

- In a fresh Draft Workspace, use `Connect draft` in the setup strip.
- When Core Draft Data is blocked, the same entry point is named `Connect to verify`.
- In a connected live draft, use `Manage <provider> draft connection` or `Manage sync`.
- For a Sleeper rehearsal, paste the supplied mock-draft URL in `Sleeper draft URL or ID`, use `Continue`, choose `Your draft slot`, and use `Start syncing`.

## Driving it with Playwright verifier

Preconditions: doctor passes and the browser context has no saved provider connection.

- Fresh connection dialog:

  ```bash
  node .agents/skills/verify-fantasy-draft-assistant/scripts/verify.mjs drive "$RUN_ID" connection-dialog
  ```

  The scenario clicks `Connect draft` or `Connect to verify`, requires the `Live draft sync` dialog, reads the `Draft provider` control, and confirms the labeled draft URL or ID field. It does not press `Continue`.

- Sleeper mock-draft connection, polling, settings, picks, and management:

  ```bash
  test -n "$SLEEPER_MOCK_URL"
  node .agents/skills/verify-fantasy-draft-assistant/scripts/verify.mjs drive \
    "$RUN_ID" sleeper-provider "$SLEEPER_MOCK_URL" 1
  ```

  Supply only a mock-draft URL created for the run. The last argument is the manager's draft slot and defaults to `1`. The scenario selects Sleeper, fills `Sleeper draft URL or ID`, presses `Continue`, confirms the slot, and presses `Start syncing`. It waits for the connected management state, saves the UI proof, then reads `/api/sync/sleeper/drafts/<draft-id>` without mutation. `provider-snapshot.json` must report provider `sleeper`, the extracted draft ID, status `synced`, positive team and round counts, and a picks array. League-linked mocks also report `draft.leagueSettings`; standalone mocks may not.

- Connected management for Yahoo and ESPN remains outside this recipe. Verify each through its own supplied provider ID or URL and record whether the Chrome extension was required.

## Gotchas

- Sleeper and Yahoo use read-only server endpoints. ESPN draft state comes from the unpacked Chrome extension and a signed-in draft-room tab.
- A connected provider can point at an active league. Do not borrow a draft ID from saved browser state.
- A Sleeper URL does not say whether the draft is a mock. The helper validates its host and numeric draft ID, but the operator must confirm that it is disposable before driving it.
- The required live preflight checks local Core Draft Data. Provider scoring and roster settings are confirmed only after connecting the Primary League.
- `sleeper-provider` proves the connection, polling, and current canonical snapshot. It does not mutate Sleeper, finish the draft, force an outage, or prove Manual Continuity reconciliation.
- Do not report `connection-dialog` as proof that provider polling, ESPN extraction, or reconciliation works.
