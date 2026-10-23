import type { DraftActions, SetDraftState } from './types';

export function createModeActions(set: SetDraftState): Pick<DraftActions, 'setSessionMode' | 'enterManualContinuity'> {
  return {
    setSessionMode: mode => { set(state => {
      state.sessionMode = mode;
      state.mockAutoAdvance.paused = false;
      if (mode === 'mock') {
        state.liveSession = null;
        state.manualContinuityBaselineAt = null;
        state.lastConfirmedSyncAt = null;
        state.lastConfirmedPickNumber = 0;
      }
    }); },
    enterManualContinuity: baselineAt => {
      if (!Number.isFinite(baselineAt) || baselineAt < 0) return;
      set(state => {
        if (state.sessionMode !== 'live' || state.liveSession?.provider !== 'sleeper') return;
        state.manualContinuityBaselineAt = baselineAt;
      });
    },
  };
}
