# Live draft connection

A drafter can connect a Sleeper, Yahoo, or ESPN draft, confirm their slot, and see imported picks and roster status. ESPN picks require the paired Chrome extension and a signed-in provider tab.

## Sub-features

- `connect-form`: Choose provider and enter a draft URL or ID.
- `connect-status`: Confirm draft slot, scoring, roster settings, and sync status.
- `connect-manage`: Refresh or disconnect an existing connection.
- `connect-espn`: Receive ESPN observations from the extension side panel.
- `connect-profile`: Select Sleeper rules for Quick Mock, Primary League practice, or actual Primary League verification.

## How to get to it (user POV)

- From `/draft`, choose `Connect draft` or `Connect to verify` in the setup strip. The header's `Manage Sleeper draft connection` opens the same connection dialog.
- Choose Sleeper, Yahoo, or ESPN; paste the provider draft URL or ID; choose `Continue`.
- When the draft loads, choose the user's draft slot, confirm the displayed scoring, roster settings, and keepers against the provider, then watch the header sync status.
- Open the header connection control to refresh or disconnect. For ESPN, pair the extension using the README's `pnpm sync:pair` steps and keep the signed-in draft tab open.

## Driving it with agent-browser

Preconditions: `control.py doctor "$RUN_ID"` passes; a real provider draft URL or ID is supplied for this run. For ESPN, the extension must be loaded, paired to this run's private server token, and observing the signed-in draft tab. The browser-only command cannot establish ESPN observation. Never use a production league draft without checking the provider settings and user's slot.

- `connect-form`: From `/draft`, take `snapshot -i`; click the visible `Connect draft` or `Connect to verify` button ref. Require dialog `Live draft sync`, `Draft provider`, and the provider's `draft URL or ID` textbox. Choose the provider using the `Draft provider` combobox, fill the textbox with the actual provider URL or ID, and click `Continue`.
- `connect-status`: Save the connection dialog and header snapshots. Require a provider draft ID, a draft-slot choice, imported pick count, and scoring and roster settings that match the provider's separate read-only view. Confirm the user's slot in the UI, then require the header to show a connected state and a changing pick count when the provider advances.
- `connect-manage`: Reopen `Manage <provider> draft connection` in the header. Use the visible refresh control, then require its timestamp or count to update. Use `Disconnect` and require the header to return to a disconnected state.
- `connect-espn`: After pairing, observe a real ESPN draft pick in the provider tab, then require the private app's pick count and board to reflect the same player and overall pick. Capture the provider view and app view separately. Do not record account credentials in evidence.
- `connect-profile`: In the Sleeper form inspect `Rules for this draft`. Exercise Quick Mock, practice with Primary League rules, and actual Primary League options, checking their descriptions and settings. With a real draft, confirm the intended profile before slot/settings checks. Source: `DraftConnect.tsx`. CLI Primary League advice does not verify this selector.

## Gotchas

- The live preflight validates data before connecting, but it cannot confirm this draft's current scoring, roster, slot, or keepers. Those require the real provider view.
- `Connect to verify` means Primary League settings still need provider confirmation. Treat a local mock's Practice settings as a separate path.
- Sleeper and Yahoo use local server polling. ESPN depends on the extension's browser observation. A healthy `/api/health` is not proof of provider sync.
- ESPN's lobby and waiting room are not draft-observation pages. Signing in, joining a mock, or creating an idle local session does not prove capture. Follow ESPN's actual draft-launch link once available, record its URL, and confirm that it matches the extension's route and manifest rules before expecting snapshots. A room that has not started is a named external prerequisite.
- This feature has no real-provider browser proof in the generated skill. The recorded provider rehearsal in `docs/` has its own scope and does not replace a fresh connection check.

## CLI cross-check

Use `sessions`, explicit-session `status`, `readiness`, `roster`, and bounded `watch` from the private app run as supplementary evidence. CLI `connect` saves its own connection and slot; it does not set the browser slot or profile and has no disconnect command. Advice uses Primary League requirements, which differ from browser Quick Mock profiles. ESPN `connected: false, waitingForObservation: true` is not sync proof. Actual provider import and ESPN observation remain unreachable without a real draft and, for ESPN, a paired signed-in draft tab. See [CLI and replay](cli-and-replay.md) for commands and evidence requirements.

## Dedicated extension verification

1. Run `control.py extension-browser` as described in the skill. Confirm the loaded extension path is the private checkout's `extension/dist`, its build targets this run's web/API ports, and the profile is the printed `browser_profile`.
2. Open the extension's options page in that browser. Copy the token from the private checkout's `.local/sync-token` into the pairing form, submit, and require `Paired`. Transfer the token directly without printing it in logs or screenshots. The everyday token must fail against the test API.
3. Open the actual extension side panel and require its iframe to load this run's web port. Capture the extension chrome and loaded app, not just a direct visit to `/sidepanel`.
4. With a supplied real provider draft, sign in within this private profile, open the draft tab, and confirm provider, draft ID, settings, and slot. Observe one provider pick; require the same player and overall pick in the extension snapshot, private app board, and CLI status against this run's API. Never submit a provider pick as part of this check.
5. Without a provider draft/login, record pairing and iframe coverage separately and mark provider observation `verified-unreachable`, naming the prerequisite and attempted route. Synthetic API posts do not prove extension observation.
6. Capture evidence, close the extension browser using `control.py stop`, and require its profile and processes to be removed while evidence remains. Do not copy provider cookies or extension storage into another profile.
