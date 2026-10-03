import * as React from 'react';

/** App-level dialogs the setup checklist can open. Absent actions fall back to written instructions. */
export interface DraftSetupActions {
  readonly openLeagueSetup?: () => void;
  readonly openDraftConnection?: () => void;
}

export const DraftSetupActionsContext = React.createContext<DraftSetupActions>({});

export function useDraftSetupActions(): DraftSetupActions {
  return React.useContext(DraftSetupActionsContext);
}
