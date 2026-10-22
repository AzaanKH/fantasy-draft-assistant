# Activate durable draft storage and recover a rollback

Production activation stays off by default. `VITE_STORAGE_ACTIVATION=idb` enables the activation path at build time. Deploy the main-compatible tombstone release before enabling activation for users. A localStorage setting or URL parameter cannot enable it.

## Activate a draft origin

Activation first checks the canonical origin and extension storage sharing. It opens IndexedDB, writes and reads a probe, deletes the probe, and dry-runs the v1 import. Open, resume snapshot, and probe cleanup waits have a timeout. A timeout or unavailable store leaves the tombstone unwritten and the draft read-only in the setup flow.

Review every invalid record, unresolved journal, rejected value, changed source, and prior refusal. Each decision binds to the exact raw bytes, incoming session, committed session, and comparison shown. A change invalidates the decision. Confirm that other draft tabs and extension side panels are closed.

The controller commits the imported sessions, retained raw source, decisions, and activation record in one IndexedDB transaction. Only after completion does it write `fantasy-draft-storage-migrated` and hand the database to the durable workspace. Normal reload resumes the committed database without another confirmation. A crash before the tombstone resumes the existing import instead of duplicating it.

## Trigger an operator rollback

The release operator triggers rollback when activation causes a storage regression, acknowledged changes disappear, old-reader compatibility fails, or recovery cannot restore a usable draft. Stop the rollout first. Use an operator development build on the affected canonical origin and close every other draft tab and extension side panel. The development operator entry is available even while startup reports a rollback in progress.

1. Stop the active workspace and call `prepareRollback(database, { storage: localStorage })`. Preparation records the cross-tab writer fence before it captures committed sessions. It also saves the exact export and any newly observed v1 source in IndexedDB.
2. Review `export.reconciliation.blockers`. Each row includes exact bytes, decoded incoming facts or rejection reasons, and the committed IndexedDB alternative. Nothing is preselected.
3. For each alternative that should be omitted from writable v1 storage, explicitly choose `keep-indexed`. Supply its blocker ID and digest to `prepareRollback(database, { storage: localStorage, decisions })`. This preserves the committed IndexedDB head. The omitted variant remains in the export and retained database. For an invalid IndexedDB row without a decodable head, that choice exports no head for that row.
4. Leave the rollback paused if an omitted pick, queue change, configuration, or session still needs reconciliation. Do not approve that row until the operator accepts that specific outcome. Cancelling leaves writers fenced and the tombstone present.
5. Call `writeRollbackExport` with the reconciled export. It refuses pending or stale decisions and new unreviewed v1 bytes. It archives exact source bytes before replacing heads or removing explicitly reviewed extra keys. A changed source requires a fresh preparation and review.
6. Save the exported JSON. Run `scripts/persistence/verify-rollback.mjs` against those exact bytes using the pinned old module checkouts. Inspect the resulting proof before finalization.
7. Call `finalizeRollback` with that export, proof, a named operator, and the close-tabs confirmation. Finalization rechecks all committed facts, retained alternatives, exact v1 bytes, and both readers' evidence. It records completion before removing the tombstone. Keep the database and export.

The development console wrapper is `window.draftStorageOperator.prepare({ otherTabsClosed: true })`. It shows per-entry choices before writing and downloading. Its `finalize(proof, { otherTabsClosed: true, operator: 'operator name' })` method recovers a saved export after reload. These controls require a development build.

`keep-indexed` is an explicit decision to omit a displayed alternative from the old app's writable data. Archiving a journal alone never permits its deletion. There is no automatic journal replay or conflict winner. To preserve an alternative in writable data instead, leave its decision unresolved and have the release owner arrange a separate reviewed reconciliation.

## Verify both old readers and their journals

The pinned readers are origin/main `8f1d26a621f4893f0c948f282e464573dd57b679` and the stack tombstone release `41debb3ccf175f6b5bbeef1806a1486043602635`. Each must load and write back the exact export in an isolated storage copy. Record the module bundle digest and compare complete session facts in both phases. Check the checkout heads against the full SHAs.

Enumerate every raw v1 journal key and decode it through the real old journal module in both phases. Require every raw key to be accounted for. An old writer may generate a covered unconfirmed journal. Exclude that generated row from `journalsDigest` only when the parsed written head's lineage contains its exact `change.writeId`. Report those covered rows separately. Hash the remaining actual decoded rows with `digestRollbackJournals` and compare with `expectedJournalsDigest`. This rollback strategy expects no unaccounted journals. Do not synthesize an empty list from the exported heads.

`rollbackFacts` compares session data while allowing old readers to sort pick and keeper rows. It preserves queue order and excludes revision, lineage, and progress bookkeeping. `toV1Session` translates an incompatible history prefix into a carry anchor at the saved cursor. The export lists each translation.

## Recover after a reload or interrupted export

Open the database without starting a workspace writer. Call `recoverRollbackExport(database)` to retrieve the exact saved payload. Recovery validates its structure and digest, the active rollback record, and the unchanged committed and retained facts. No saved export returns `null`. A malformed export or changed database throws and leaves the tombstone in place.

If export writing was interrupted, retry `writeRollbackExport` with the recovered export. If new v1 facts appeared, prepare and review again instead. If writing completed, reuse proof only when its `exportDigest` equals the recovered digest. If completion was recorded before tombstone removal failed, recover the same export and repeat `finalizeRollback`. Do not prepare a different export after completion. Never remove the tombstone manually to bypass a failed check.

## Soak before retiring v1 writers

The rollout owner should require at least 14 consecutive days of successful activated use, including a complete live-draft rehearsal. Extend the period until every supported extension release has propagated through the store and its measured update lag has elapsed. Record the deployed versions, observation dates, and any active old clients.

Exit criteria are no unexplained acknowledged-write loss, no unresolved activation or rollback defects, passed final-head transaction and production UI gates, native hidden-to-visible recovery evidence, and an exact pinned-reader rollback rehearsal including journal accounting. Reset the soak after a storage correctness incident.

Unit 11d owns v1 writer deletion. Delete the writer only after the rollout owner records those exit criteria and a supported recovery procedure. Continue honoring the tombstone for as long as an old cached tab or extension version can exist, including extension-store release lag. Do not expire the tombstone on a timer or delete retained IndexedDB and rollback artifacts as part of writer retirement.
