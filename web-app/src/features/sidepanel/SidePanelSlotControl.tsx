import type { ReactElement } from 'react';
import { Select } from '@/components/ui/select';
import { useConnectionState, useDraftState, useWorkspace } from '@/workspace/WorkspaceProvider';
import { dispatchWorkspace } from '@/workspace/ui-dispatch';

export function SidePanelSlotControl(): ReactElement | null {
  const connection = useConnectionState(state => state.connection);
  const totalTeams = useDraftState(state => state.config.totalTeams);
  const workspace = useWorkspace();
  if (!connection || connection.draftPosition !== null) return null;
  return <section className="m-3 space-y-2 rounded-xl border border-border bg-card p-3" aria-label="Confirm your draft slot">
    <p className="text-sm font-semibold">Choose your draft slot</p>
    <p className="text-xs text-muted-foreground">Choose your slot to start importing picks for this draft.</p>
    <Select aria-label="Your draft slot" value="" options={[
      { value: '', label: 'Choose a slot', disabled: true },
      ...Array.from({ length: totalTeams }, (_, index) => ({ value: String(index + 1), label: `Slot ${String(index + 1)}` })),
    ]} onValueChange={value => { dispatchWorkspace(workspace, 'connection.confirmDraftPosition', Number(value)); }} />
  </section>;
}
