import type { Workspace } from './workspace';
import { openDraftDatabase, type DraftDatabase } from './indexed-db';
import { decodeIndexedSession } from './idb-session';
import { prepareRollback, recoverRollbackExport, writeRollbackExport, finalizeRollback,
  type RollbackDecision, type RollbackExport, type RollbackVerification } from './rollback-export';

interface RollbackOperator {
  prepare(confirmation: { readonly otherTabsClosed: true }, decisions?: readonly RollbackDecision[]): Promise<RollbackExport>;
  finalize(verification: RollbackVerification, confirmation: { readonly otherTabsClosed: true; readonly operator: string }): Promise<void>;
}

declare global { interface Window { draftStorageOperator?: RollbackOperator } }
function requireClosedTabs(value: unknown): void {
  if (value !== true) throw new Error('Close all other draft tabs and side panels first');
}
function download(exported: RollbackExport): void {
  const link = document.createElement('a');
  const url = URL.createObjectURL(new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' }));
  link.href = url; link.download = 'draft-storage-rollback.json'; link.click();
  setTimeout(() => { URL.revokeObjectURL(url); }, 0);
}
function reviewRollback(exported: RollbackExport, accept: (decisions: readonly RollbackDecision[]) => Promise<unknown>): void {
  document.getElementById('draft-rollback-review')?.remove();
  const dialog = document.createElement('dialog'); dialog.id = 'draft-rollback-review'; dialog.open = true;
  dialog.setAttribute('aria-label', 'Review rollback entries');
  dialog.style.cssText = 'position:fixed;inset:5%;z-index:99999;overflow:auto;max-height:90vh;padding:24px';
  const title = document.createElement('h1'); title.textContent = 'Review retained draft entries before rollback'; dialog.append(title);
  const explanation = document.createElement('p'); explanation.textContent = 'Each choice keeps the committed IndexedDB head. Every decodable retained journal is also exported to v1 journal storage. Old apps may consume resolved journals or delete unsupported orphan journals; exact originals remain recoverable in IndexedDB and the export. Corrupt or unencodable alternatives remain in the recovery export after your explicit choice. Cancel leaves writers stopped and the migration marker in place.'; dialog.append(explanation);
  const choices = new Map<string, RollbackDecision>();
  const submit = document.createElement('button'); submit.textContent = 'Export reconciled rollback'; submit.disabled = true;
  for (const blocker of exported.reconciliation.blockers) {
    const section = document.createElement('section'); const detail = document.createElement('details'); const summary = document.createElement('summary');
    summary.textContent = blocker.entry.key; const pre = document.createElement('pre'); pre.textContent = JSON.stringify(blocker, null, 2); detail.append(summary, pre);
    const label = document.createElement('label'); const input = document.createElement('input'); input.type = 'checkbox';
    input.addEventListener('change', () => {
      if (input.checked) choices.set(blocker.id, { blockerId: blocker.id, digest: blocker.digest, action: 'keep-indexed' });
      else choices.delete(blocker.id);
      submit.disabled = choices.size !== exported.reconciliation.blockers.length;
    });
    const journal = exported.journals.some(row => row.serialized === blocker.entry.serialized);
    label.append(input, document.createTextNode(journal
      ? ` Keep the IndexedDB head and export ${blocker.entry.key} as a separate v1 journal`
      : ` Keep the IndexedDB version instead of ${blocker.entry.key}; retain this alternative only in recovery data`)); section.append(detail, label); dialog.append(section);
  }
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  submit.addEventListener('click', () => {
    submit.disabled = true;
    void accept([...choices.values()]).then(() => { dialog.remove(); }).catch((error: unknown) => { status.textContent = String(error); submit.disabled = false; });
  });
  const cancel = document.createElement('button'); cancel.textContent = 'Cancel rollback'; cancel.addEventListener('click', () => { dialog.remove(); });
  dialog.append(submit, cancel, status); document.body.append(dialog);
}

export function installRollbackOperator(workspace?: Workspace): void {
  if (!import.meta.env.DEV) throw new Error('Rollback requires an operator development build');
  let database: DraftDatabase | undefined;
  let exported: RollbackExport | undefined;
  const open = async (): Promise<DraftDatabase> => database ??= await openDraftDatabase({ factory: indexedDB, decode: decodeIndexedSession, report: () => undefined });
  const operator: RollbackOperator = {
    async prepare(confirmation, decisions = []) {
      requireClosedTabs(confirmation.otherTabsClosed);
      workspace?.dispose();
      const db = await open();
      exported = await prepareRollback(db, { storage: localStorage, decisions });
      if (exported.reconciliation.pending.length || exported.reconciliation.stale.length) {
        reviewRollback(exported, choices => operator.prepare(confirmation, choices));
        return exported;
      }
      await writeRollbackExport({ database: db, storage: localStorage, export: exported });
      download(exported);
      return exported;
    },
    async finalize(verification, confirmation) {
      requireClosedTabs(confirmation.otherTabsClosed);
      const db = await open();
      exported ??= await recoverRollbackExport(db) ?? undefined;
      if (!exported) throw new Error('Prepare and verify the exact export before removing the migration marker');
      await finalizeRollback({ database: db, storage: localStorage, export: exported, verification, confirmation });
      db.close(); database = undefined;
    },
  };
  window.draftStorageOperator = operator;
}
