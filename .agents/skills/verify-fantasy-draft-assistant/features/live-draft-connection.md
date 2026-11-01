# Live draft connection

A drafter can connect a Sleeper, Yahoo, or ESPN draft, confirm their slot, and see imported picks and roster status. ESPN picks require the paired Chrome extension and a signed-in provider tab.

## Sub-features

- `connect-form`: Choose provider and enter a draft URL or ID.
- `connect-status`: Confirm draft slot, scoring, roster settings, and sync status.
- `connect-manage`: Refresh or disconnect an existing connection.
- `connect-espn`: Receive ESPN observations from the extension side panel.
- `connect-profile`: Select Sleeper rules for Quick Mock, Primary League practice, or actual Primary League verification.
- `league-setup`: Choose Quick mock or Primary League rules in the League setup dialog.
- `connect-continuity`: Record provisional picks during a provider outage (Manual Continuity) and reconcile them later.

## How to get to it (user POV)

- From `/draft`, open the header's `Manage <Provider> draft connection` button (it shows the provider and a status such as `Disconnected`). The blocked-readiness notice's `Connect league` and League setup's `Connect Primary League` open the same dialog. There are no `Connect draft` or `Connect to verify` buttons.
- In `Live draft sync`, choose `Rules for this draft` (Sleeper only), pick the `Draft provider` (native select: Sleeper, ESPN, Yahoo), fill `<Provider> draft URL or ID`, and choose `Continue`.
- When the draft loads, choose `Your draft slot` and click `Start syncing`. The connected panel shows FORMAT, ROUNDS, YOUR SLOT, PICKS SYNCED, and how many of your picks were imported, with `Disconnect`, `Refresh now`, and `Done`. Scoring and roster settings appear in the header's `Draft status` popover, not in this dialog.
- League setup opens from the `Draft status: …` header button's popover via `League setup`. For ESPN, pair the extension using the README's `pnpm sync:pair` steps and keep the signed-in draft tab open.

## Driving it with agent-browser

Preconditions: `control.py doctor "$RUN_ID"` passes; a real provider draft URL or ID is supplied for this run. For ESPN, the extension must be loaded, paired to this run's private server token, and observing the signed-in draft tab. The browser-only command cannot establish ESPN observation. Never use a production league draft without checking the provider settings and user's slot.

- `connect-form`: From `/draft`, click `Manage Sleeper draft connection`. Require dialog `Live draft sync`, `Rules for this draft`, `Draft provider`, and the `Sleeper draft URL or ID` textbox, with `Continue` disabled while it is empty. Without a real draft, enter `1` and click `Continue`; require `Sleeper draft could not be synced` and `Sleeper request failed: 404` with an `Edit draft details` button. With a real draft, choose the provider, fill the real URL or ID, and click `Continue`.
- `connect-status`: Choose `Your draft slot` and click `Start syncing`. Require the URL to gain `?provider=…&draftId=…&position=N`, the header to read a connected state such as `Complete · just now`, and the panel's FORMAT, ROUNDS, YOUR SLOT, and PICKS SYNCED to match the provider's separate read-only view (for example Sleeper's `/v1/draft/<id>`). Check scoring and roster in the `Draft status` popover. For an in-progress draft, require the pick count to change when the provider advances.
- `connect-manage`: In the connected dialog, click `Refresh now` and require `Last sync just now` with no error. Click `Disconnect` and require the dialog to close, the URL query to clear, and the header to read `Disconnected`.
- `connect-espn`: After pairing, observe a real ESPN draft pick in the provider tab, then require the private app's pick count and board to reflect the same player and overall pick. Capture the provider view and app view separately. Do not record account credentials in evidence.
- `connect-profile`: In the Sleeper form inspect `Rules for this draft`. Its options are `Quick mock · Default league rules`, `Practice with Primary League rules`, and `Actual Primary League · Verify with Sleeper`; check each description. Switching `Draft provider` to ESPN or Yahoo hides the selector. With a real draft, confirm the intended profile before slot/settings checks. Source: `DraftConnect.tsx`. CLI Primary League advice does not verify this selector.
- `league-setup`: Click the header's `Draft status: …` button, then `League setup`. Require the `Quick mock` / `Primary League` toggle (`aria-pressed`). Quick mock shows editable Teams, Rounds, Reception scoring, and Passing touchdown with `Restore defaults` and `Use quick mock settings`. Primary League shows the maintained preset (for example 10 teams · 14 rounds) with `Connect Primary League` and `Use Primary League practice settings`. Close without saving unless the scenario needs a profile change. Source: `LeagueSetupDialog.tsx`.
- `connect-continuity`: Requires a connected draft that is still drafting and whose provider sync becomes delayed. Mark it `verified-unreachable` against a completed draft, naming that prerequisite. Source: `ManualContinuityControl.tsx`, `ProvisionalPickDialog.tsx`.

## Gotchas

- `Edit draft details` on the error panel disconnects, clears the URL query, and closes the dialog. Reopen it from the header to try again.
- On a first connection, the dialog can stay on `Connecting to Sleeper...` (header `Reconciling · No sync yet`) even though the server has already synced the draft. Confirm the server state with `control.py cli "$RUN_ID" -- sessions --json`; if the session is `synced`, reload the page and reopen the dialog to reach the slot step. Record this as a product issue, not a passing step.
- The live preflight validates data before connecting, but it cannot confirm this draft's current scoring, roster, slot, or keepers. Those require the real provider view.
- The `Actual Primary League · Verify with Sleeper` profile means Primary League settings still need provider confirmation. Treat a local mock's Practice settings as a separate path.
- Sleeper and Yahoo use local server polling. ESPN depends on the extension's browser observation. A healthy `/api/health` is not proof of provider sync.
- ESPN's lobby and waiting room are not draft-observation pages. Signing in, joining a mock, or creating an idle local session does not prove capture. Follow ESPN's actual draft-launch link once available, record its URL, and confirm that it matches the extension's route and manifest rules before expecting snapshots. A room that has not started is a named external prerequisite.
- This feature has no real-provider browser proof in the generated skill. The recorded provider rehearsal in `docs/` has its own scope and does not replace a fresh connection check.

## CLI cross-check

Use `sessions`, explicit-session `status`, `readiness`, `roster`, and bounded `watch` from the private app run as supplementary evidence. CLI `connect` saves its own connection and slot; it does not set the browser slot or profile and has no disconnect command. Advice uses Primary League requirements, which differ from browser Quick Mock profiles. ESPN `connected: false, waitingForObservation: true` is not sync proof. Actual provider import and ESPN observation remain unreachable without a real draft and, for ESPN, a paired signed-in draft tab. See [CLI and replay](cli-and-replay.md) for commands and evidence requirements.

## Dedicated extension verification

1. Run `control.py extension-browser` as described in the skill. Confirm the loaded extension path is the private checkout's `extension/dist`, its build targets this run's web/API ports, and the profile is the printed `browser_profile`.
2. Open the extension's options page in that browser. Copy the token from the private checkout's `.local/sync-token` into the pairing form, submit, and require `Paired`. Transfer the token directly without printing it in logs or screenshots. The everyday token must fail against the test API.
   The options page reports success with `Paired. Refresh the provider draft tab to connect.`; the unpaired state reads `This extension is not paired yet.`, so match case-sensitively.
3. Open the actual extension side panel and require its iframe to load this run's web port. Unpaired, the panel shows `Pair this extension` and `Open pairing options`. Capture the extension chrome and loaded app, not just a direct visit to `/sidepanel`.
4. With a supplied real provider draft, sign in within this private profile, open the draft tab, and confirm provider, draft ID, settings, and slot. Observe one provider pick; require the same player and overall pick in the extension snapshot, private app board, and CLI status against this run's API. Never submit a provider pick as part of this check.
5. Without a provider draft/login, record pairing and iframe coverage separately and mark provider observation `verified-unreachable`, naming the prerequisite and attempted route. Synthetic API posts do not prove extension observation.
The helper launches a headed browser without a debugging port, so an agent without desktop control can verify only the launch and the private build's manifest ports (`extension/dist/manifest.json` host permissions and frame CSP). Record pairing and side-panel steps as blocked by that harness limit rather than passed.
6. Capture evidence, close the extension browser using `control.py stop`, and require its profile and processes to be removed while evidence remains. Do not copy provider cookies or extension storage into another profile.
