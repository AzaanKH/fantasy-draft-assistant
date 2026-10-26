# Activate durable draft storage and recover a rollback

Production activation is on by default for the web app and extension. The main-compatible tombstone release is on main. The shared build-time switch defaults to `idb`; a localStorage setting or URL parameter cannot change it.

The hosted static demo is an explicit v1 exception. `pnpm build:web:demo` and `pnpm dev:web:demo` set `VITE_STORAGE_ACTIVATION=v1`. HTTPS demo origins cannot share the canonical localhost app's storage and do not activate it.

To build the v1 rollback release for both consumers, run:

```sh
VITE_STORAGE_ACTIVATION=v1 pnpm build
```

This build selects the v1 path without opening IndexedDB. It still honors an existing tombstone. Before users can write v1 again, complete the operator rollback export and verification below. Changing the build switch alone does not remove the marker.

## Activate a draft origin

Activation first checks the canonical origin and extension storage sharing. It opens IndexedDB, writes and reads a probe, deletes the probe, and dry-runs the v1 import. Open, resume snapshot, and probe cleanup waits have a timeout. A timeout or unavailable store leaves the tombstone unwritten and the draft read-only in the setup flow.

Review every invalid record, unresolved journal, rejected value, changed source, and prior refusal. Each decision binds to the exact raw bytes, incoming session, committed session, and comparison shown. A change invalidates the decision. Confirm that other draft tabs and extension side panels are closed. The pre-tombstone `8f1d26a` release cannot observe the marker and remains an unfenced writer under either build mode. The close-tabs confirmation mitigates that accepted Amendment 8 risk. The tombstone-aware main release freezes writes without changing saved bytes.

The controller commits the imported sessions, retained raw source, decisions, and activation record in one IndexedDB transaction. Only after completion does it write `fantasy-draft-storage-migrated` and hand the database to the durable workspace. Normal reload resumes the committed database without another confirmation. A crash before the tombstone resumes the existing import instead of duplicating it.

## Use the installed side panel in production

Keep a normal draft app tab open at the configured canonical localhost origin before opening the installed extension side panel. Allow the extension's host permission for that origin. The panel loads the app iframe directly and verifies storage sharing with the ordinary app tab through a nonce round trip. Multiple open app tabs select one responder for each check.

Production does not open a temporary helper tab or serve `__storageProbe`. That helper is available only when both development mode and `VITE_PERSISTENCE_HARNESS=idb` are enabled. An ON production build uses the same sharing check without that test URL.

If no ordinary app tab responds, setup shows "Keep the draft web app open in a normal tab, then retry the side panel storage check." Open the canonical app tab and retry the panel. A denied permission or partitioned iframe also blocks setup. These failures never fall back to the v1 writer or acknowledge a draft change.

## Trigger an operator rollback

The release operator triggers rollback when activation causes a storage regression, acknowledged changes disappear, old-reader compatibility fails, or recovery cannot restore a usable draft. Stop the rollout first. Use an operator development build on the affected canonical origin and close every other draft tab and extension side panel. The development operator entry is available even while startup reports a rollback in progress.

1. Stop the active workspace and call `prepareRollback(database, { storage: localStorage })`. Preparation records the cross-tab writer fence before it captures committed sessions. It also saves the exact export and any newly observed v1 source in IndexedDB.
2. Review `export.reconciliation.blockers`. Each row includes exact bytes, decoded incoming facts or rejection reasons, and the committed IndexedDB alternative. Nothing is preselected.
3. Review each alternative and explicitly choose `keep-indexed` with its blocker ID and digest. This preserves the committed IndexedDB head. Every decodable retained journal also becomes a real v1 journal row with its original serialized bytes. The choice acknowledges that the journal remains separate from the committed head. Corrupt records, unencodable journals, and conflicting retained heads stay in recovery data after this explicit choice. For an invalid IndexedDB row without a decodable head, the choice exports no head for that row.
4. Leave the rollback paused if an alternative still needs reconciliation. Do not approve that row until the operator accepts its displayed outcome. Cancelling leaves writers fenced and the tombstone present.
5. Call `writeRollbackExport` with the reconciled export. It refuses pending or stale decisions and new unreviewed v1 bytes. It archives exact source bytes before replacing heads or removing explicitly reviewed extra keys. A changed source requires a fresh preparation and review.
6. Save the exported JSON. Run `scripts/persistence/verify-rollback.mjs` against those exact bytes using the pinned old module checkouts. Inspect the resulting proof before finalization.
7. Call `finalizeRollback` with that export, proof, a named operator, and the close-tabs confirmation. Finalization rechecks all committed facts, retained alternatives, exact v1 bytes, and both readers' evidence. It records completion before removing the tombstone. Keep the database and export.

The development console wrapper is `window.draftStorageOperator.prepare({ otherTabsClosed: true })`. It shows per-entry choices before writing and downloading. Its `finalize(proof, { otherTabsClosed: true, operator: 'operator name' })` method recovers a saved export after reload. These controls require a development build.

`export.writes` contains both v1 session heads and v1 journals. `export.journals` lists each journal's exact bytes, decoded change, and `covered` or `unresolved` status against the committed head lineage. Each journal uses a deterministic tab key derived from its draft identity and original bytes. Distinct same-key variants receive separate keys, even when they share a write ID. Exact duplicate bytes for the same draft share one row. Original keys and bytes remain in retained metadata and the export. Preparation never invents a base write ID or lineage entry and never applies unresolved journal data to committed heads.

An explicit `keep-indexed` choice cannot omit a decodable retained journal from v1 storage. Only corrupt or unencodable journal alternatives remain solely in recovery data after review. `clearKeys` names reviewed stale keys, excludes every new write key, and requires the captured bytes still to match before deletion. There is no automatic journal conflict winner.

## Verify both old readers and their journals

The pinned readers are origin/main `8f1d26a621f4893f0c948f282e464573dd57b679` and the stack tombstone release `41debb3ccf175f6b5bbeef1806a1486043602635`. `verify-rollback.mjs` checks every extracted store, library, and shared source file against the corresponding pinned Git tree before and after execution. It records that source digest in the verification evidence.

The proof enumerates every raw v1 journal key, including journals without a session head, and calls the real old `readDraftSessionChanges`. Every key and original serialized byte must match the export manifest. `expectedJournalsDigest` hashes every actual journal key and decoded change, including covered rows. It ignores only the version envelope that old readers omit and JSON formatting that old writers normalize. The export digest and an independent journal byte digest bind the exact original serialization.

The proof writes every decoded journal through the actual old `writeDraftSessionChange` into an isolated copy, reads those rows back with the old reader, and requires the same journal facts digest. It separately writes committed session heads through the real old `draftStore` without replaying retained journals. Any generated journal must have its exact write ID in the written head lineage. Both pinned sources must pass both phases before finalization.

The detailed proof also runs an ordinary old store against a full export copy. It reports the resulting heads, remaining journals, and removed journals. Ordinary old stores consume covered journals and can delete unsupported orphan journals during recovery. Journal codec compatibility does not promise indefinite orphan retention by those old stores. Every original stays recoverable in IndexedDB and the saved export after that consumption. The proof never substitutes this ordinary-store outcome for the required journal reader and writer checks.

`rollbackFacts` compares session data while allowing old readers to sort pick and keeper rows. It preserves queue order and excludes revision, lineage, and progress bookkeeping. `toV1Session` translates an incompatible history prefix into a carry anchor at the saved cursor. The export lists each translation.

## Recover after a reload or interrupted export

Open the database without starting a workspace writer. Call `recoverRollbackExport(database)` to retrieve the exact saved payload. Recovery validates its structure and digest, the active rollback record, and the unchanged committed and retained facts. No saved export returns `null`. A malformed export or changed database throws and leaves the tombstone in place.

If export writing was interrupted, retry `writeRollbackExport` with the recovered export. If new v1 facts appeared, prepare and review again instead. If writing completed, reuse proof only when its `exportDigest` equals the recovered digest. If completion was recorded before tombstone removal failed, recover the same export and repeat `finalizeRollback`. Do not prepare a different export after completion. Never remove the tombstone manually to bypass a failed check.

## Soak before retiring v1 writers

The soak clock starts when this default-on release is deployed. The rollout owner must record the deployment time and require at least 14 consecutive days of successful activated use, including a complete live-draft rehearsal. Extend the period until every supported extension release has propagated through the store and its measured update lag has elapsed. Record the deployed versions, observation dates, and any active old clients.

Exit criteria are no unexplained acknowledged-write loss, no unresolved activation or rollback defects, passed final-head transaction and production UI gates, native hidden-to-visible recovery evidence, and an exact pinned-reader rollback rehearsal including journal accounting. Reset the soak after a storage correctness incident.

Unit 11d owns v1 writer deletion. Delete the writer only after the rollout owner records those exit criteria and a supported recovery procedure. Continue honoring the tombstone for as long as an old cached tab or extension version can exist, including extension-store release lag. Do not expire the tombstone on a timer or delete retained IndexedDB and rollback artifacts as part of writer retirement.

## Check native visibility recovery

Native hidden-to-visible recovery is proven at `2eb3a06` on 2026-10-24. All five tab switches and all five minimize/restore trials retained the acknowledged write without a reload. Each tab-switch trial began a real IndexedDB read while visible and unfocused, before focus. Minimize/restore proves recovery; macOS focused the receiver naturally, so those trials do not isolate visibility from focus.

Read the [round 2 evidence](../../artifacts/agent-friendly-plan/units/flip/native-visibility/round2/NATIVE-VISIBILITY.md), [trial results](../../artifacts/agent-friendly-plan/units/flip/native-visibility/round2/results.json), and [independent audit](../../artifacts/agent-friendly-plan/units/flip/native-visibility/round2/evidence-audit.json) in the operator's retained artifacts.

The opt-in headed check is outside `pnpm verify`. Run it on macOS with the recorded Playwright 1.57 implementation and a fresh absolute output directory:

```sh
NATIVE_VISIBILITY_OUTPUT=/absolute/path/to/fresh-evidence pnpm --filter scripts exec tsx --conditions=@fantasy-draft/source ../scripts/persistence/native-visibility.mjs
```

The check disables focus emulation on Playwright's owning main-frame CDP session. Disabling it on an additional session leaves Playwright's override active and prevents native hiding. The private session access is version-specific. Recheck it before upgrading Playwright. The check preserves browser profiles and closes only its own browser contexts and static server.

The check exits with failure if either five-trial path is incomplete or fails, a page error occurs, or cleanup fails. A partial native proof cannot return success.

## Check the release default and rollback readers

Run the opt-in production first-run proof on a clean committed head, with installed demo data and a fresh evidence directory:

```sh
FLIP_EXPECTED_HEAD=$(git rev-parse HEAD) FLIP_OUTPUT=/absolute/path/to/fresh-flip-evidence pnpm --filter scripts exec tsx --conditions=@fantasy-draft/source ../scripts/persistence/flip-first-run.mjs --browser-authorized
```

It seeds bytes from real `origin/main` and `8f1d26a` modules, checks read-only review and confirmation, verifies the import and tombstone, and checks reload recovery. It captures the production database and runs the real rollback exporter against an isolated copy. Both pinned old readers load and write that exact output, including journals. The v1 build also loads the rollback output and writes without opening IndexedDB. The proof records the pre-tombstone writer's unfenced behavior under both build modes. It does not remove a marker from the production origin.
