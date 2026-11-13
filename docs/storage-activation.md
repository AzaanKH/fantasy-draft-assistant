# Draft storage

Drafts are saved in IndexedDB (`fantasy-draft-workspace-v2`) in the web app, the extension side panel and the hosted static demo. It is the only storage the app writes. The localStorage writer (version 1), the `VITE_STORAGE_ACTIVATION` build switch, the storage setup screen and the operator rollback tooling were removed on 2026-11-12, after the rollout owner completed a full live draft on IndexedDB with nothing lost.

A demo build on an origin other than the canonical localhost app keeps its drafts in that origin's own IndexedDB (`verifyHostedDemoStorage`) and does not run the localhost sharing check.

## What happens when the app opens

Startup checks the canonical origin and extension storage sharing, then opens IndexedDB, writes and reads a probe, and deletes the probe. Open, resume snapshot and probe cleanup waits have a timeout. If storage cannot open, the app shows why and a Reload button; nothing is written and no marker is set.

A browser that has already opened the app resumes its committed database directly.

On the first open in a browser, `showStorageActivation` in [activation-entry.tsx](../web-app/src/workspace/activation-entry.tsx) commits the activation record and writes the `fantasy-draft-storage-migrated` marker to localStorage. There is no review screen and nothing to confirm.

## Drafts saved in the older format

The read-only importer in [v1-import.ts](../web-app/src/workspace/v1-import.ts) stays. If a browser still holds version 1 records, startup moves them into IndexedDB in the same transaction as the activation record, without asking. The original localStorage keys are never changed or removed, and the raw source bytes are also retained in IndexedDB.

Records that used to need a person's decision are settled by `settleActivation`: the session is kept as imported where that is offered, and the entry is left out of the import otherwise. Both outcomes keep the original bytes. If a saved record changes between the check and the write, startup reads the records again, up to three times, then shows the storage error.

Nothing in the app writes version 1 any more, so the old close-other-tabs confirmation is gone. The one writer that can still race is a browser tab or extension build older than this release that is still open. The marker stops every release that knows about it; the pre-marker `8f1d26a` release cannot see it. Close old tabs before opening a newer build in a browser that holds unmigrated drafts.

## What was kept on purpose

- The `fantasy-draft-storage-migrated` marker is still written and never expires. It fences old cached tabs and extension versions.
- Retained raw version 1 source, import metadata and prior activation records stay in IndexedDB. Do not delete them as cleanup.
- A database left mid-rollback by the removed operator tooling still refuses to open for writing (`rollback-in-progress`). No such database is expected; recovering one needs the tooling from before this change (`git show 89af465`).

There is no supported way back to localStorage storage. Recovering from a storage defect means fixing it forward; the version 1 bytes of any imported draft remain readable in localStorage and IndexedDB.

## Use the installed side panel in production

Keep a normal draft app tab open at the configured canonical localhost origin before opening the installed extension side panel. Allow the extension's host permission for that origin. The panel loads the app iframe directly and verifies storage sharing with the ordinary app tab through a nonce round trip. Multiple open app tabs select one responder for each check.

Production does not open a temporary helper tab or serve `__storageProbe`. That helper is available only when both development mode and `VITE_PERSISTENCE_HARNESS=idb` are enabled. A production build uses the same sharing check without that test URL.

If no ordinary app tab responds, setup shows "Keep the draft web app open in a normal tab, then retry the side panel storage check." Open the canonical app tab and retry the panel. A denied permission or partitioned iframe also blocks setup. These failures never acknowledge a draft change.

## Check native visibility recovery

Native hidden-to-visible recovery is proven at `2eb3a06` on 2026-10-24. All five tab switches and all five minimize/restore trials retained the acknowledged write without a reload. Each tab-switch trial began a real IndexedDB read while visible and unfocused, before focus. Minimize/restore proves recovery; macOS focused the receiver naturally, so those trials do not isolate visibility from focus.

Read the [round 2 evidence](../../artifacts/agent-friendly-plan/units/flip/native-visibility/round2/NATIVE-VISIBILITY.md), [trial results](../../artifacts/agent-friendly-plan/units/flip/native-visibility/round2/results.json), and [independent audit](../../artifacts/agent-friendly-plan/units/flip/native-visibility/round2/evidence-audit.json) in the operator's retained artifacts.

The opt-in headed check is outside `pnpm verify`. Run it on macOS with the recorded Playwright 1.57 implementation and a fresh absolute output directory:

```sh
NATIVE_VISIBILITY_OUTPUT=/absolute/path/to/fresh-evidence pnpm --filter scripts exec tsx --conditions=@fantasy-draft/source ../scripts/persistence/native-visibility.mjs
```

The check disables focus emulation on Playwright's owning main-frame CDP session. Disabling it on an additional session leaves Playwright's override active and prevents native hiding. The private session access is version-specific. Recheck it before upgrading Playwright. The check preserves browser profiles and closes only its own browser contexts and static server.

The check exits with failure if either five-trial path is incomplete or fails, a page error occurs, or cleanup fails. A partial native proof cannot return success.
