import type { DraftActions } from '@/stores/draft/types';
import type { DraftSyncConnectionStore } from '@/stores/draftSyncStore';

export type ConnectionActions = Omit<DraftSyncConnectionStore, 'connection'>;
export type WorkspaceActions = DraftActions & {
  [K in keyof ConnectionActions as `connection.${K}`]: ConnectionActions[K];
};
type CommandName = keyof WorkspaceActions;
export type WorkspaceCommand<K extends CommandName = CommandName> = {
  [P in K]: [type: P, ...args: Parameters<WorkspaceActions[P]>];
}[K];
type BooleanCommand = 'recordProvisionalPick' | 'correctProvisionalPick' | 'removeProvisionalPick';
type ReconcileCommand = 'reconcileSyncedPicks';
export type VoidWorkspaceCommand = WorkspaceCommand<Exclude<CommandName, BooleanCommand | ReconcileCommand>>;
export interface WorkspaceSend {
  (...command: WorkspaceCommand<BooleanCommand>): boolean;
  (...command: WorkspaceCommand<ReconcileCommand>): ReturnType<DraftActions[ReconcileCommand]>;
  (...command: VoidWorkspaceCommand): void;
}
