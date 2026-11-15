# Draft storage proofs

These opt-in browser proofs exercise draft storage in the real app. None runs in `pnpm verify`. See [docs/storage-activation.md](../../docs/storage-activation.md) for how storage behaves.

| Script | What it proves | Runs in CI |
| --- | --- | --- |
| `flip-demo.mjs` | A hosted static demo build opens on IndexedDB only, writes no version 1 keys, sets the marker and survives a reload. | yes |
| `native-visibility.mjs` | A hidden tab recovers an acknowledged write when it becomes visible, without a reload. macOS, headed. Its helpers are the `ui-*.mjs` files; `ui-seed.mjs` writes older-format drafts for the importer to move. | no |

The runner that characterised the localStorage writer (`pnpm test:persistence`, its loss bands and audits) was removed with that writer on 2026-11-12, as were the rollback and old-reader proofs. The cross-tab UI activation proof (`ui-activation.mjs`, its smoke driver and its tests) was removed on 2026-11-14; it had no package script or CI step.

The development switch `VITE_PERSISTENCE_HARNESS=idb` and `web-app/src/workspace/harness-workspace.ts` were driven only by that runner. Nothing sets the switch now; they are left in place and can be removed in a separate change.
