# Draft storage proofs

These opt-in browser proofs exercise draft storage in the real app. None runs in `pnpm verify`. See [docs/storage-activation.md](../../docs/storage-activation.md) for how storage behaves.

| Script | What it proves | Runs in CI |
| --- | --- | --- |
| `flip-demo.mjs` | A hosted static demo build opens on IndexedDB only, writes no version 1 keys, sets the marker and survives a reload. | yes |
| `ui-activation.mjs` | The production UI keeps every acknowledged pick and queue change across tabs and the extension side panel. Its helpers are the other `ui-*.mjs` files; `ui-seed.mjs` writes older-format drafts for the importer to move. | no |
| `root-smoke-driver.mjs` | A bounded smoke run of the UI proof with recorded evidence. | no |
| `native-visibility.mjs` | A hidden tab recovers an acknowledged write when it becomes visible, without a reload. macOS, headed. | no |

The runner that characterised the localStorage writer (`pnpm test:persistence`, its loss bands and audits) was removed with that writer on 2026-11-12, as were the rollback and old-reader proofs.

The development switch `VITE_PERSISTENCE_HARNESS=idb` and `web-app/src/workspace/harness-workspace.ts` were driven only by that runner. Nothing sets the switch now; they are left in place and can be removed in a separate change.
