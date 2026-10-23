# Activate durable draft storage and recover a rollback

Production activation stays off by default. `VITE_STORAGE_ACTIVATION=idb` enables the activation path at build time. Deploy the main-compatible tombstone release before enabling activation for users. A localStorage setting or URL parameter cannot enable it.

## Activate a draft origin

Activation first checks the canonical origin and extension storage sharing. It opens IndexedDB, writes and reads a probe, deletes the probe, and dry-runs the v1 import. Open, resume snapshot, and probe cleanup waits have a timeout. A timeout or unavailable store leaves the tombstone unwritten and the draft read-only in the setup flow.

Review every invalid record, unresolved journal, rejected value, changed source, and prior refusal. Each decision binds to the exact raw bytes, incoming session, committed session, and comparison shown. A change invalidates the decision. Confirm that other draft tabs and extension side panels are closed.

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

The rollout owner should require at least 14 consecutive days of successful activated use, including a complete live-draft rehearsal. Extend the period until every supported extension release has propagated through the store and its measured update lag has elapsed. Record the deployed versions, observation dates, and any active old clients.

Exit criteria are no unexplained acknowledged-write loss, no unresolved activation or rollback defects, passed final-head transaction and production UI gates, native hidden-to-visible recovery evidence, and an exact pinned-reader rollback rehearsal including journal accounting. Reset the soak after a storage correctness incident.

Unit 11d owns v1 writer deletion. Delete the writer only after the rollout owner records those exit criteria and a supported recovery procedure. Continue honoring the tombstone for as long as an old cached tab or extension version can exist, including extension-store release lag. Do not expire the tombstone on a timer or delete retained IndexedDB and rollback artifacts as part of writer retirement.
