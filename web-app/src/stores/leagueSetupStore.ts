import { create } from 'zustand';
import { IS_DEMO } from '@/lib/demo-mode';
import { DEFAULT_QUICK_MOCK, isQuickMockPreferences, type QuickMockPreferences } from '@/lib/quick-mock-settings';

const LEAGUE_SETUP_STORAGE_KEY = 'fantasy-draft-league-setup-v1';
export type LocalLeagueProfile = 'quick-mock' | 'primary-league';
interface LeagueSetupState {
  readonly profile: LocalLeagueProfile;
  readonly quickMock: QuickMockPreferences;
  save: (profile: LocalLeagueProfile, quickMock: QuickMockPreferences) => void;
}
function readPreferences(): Pick<LeagueSetupState, 'profile' | 'quickMock'> {
  const fallback = { profile: 'quick-mock' as const, quickMock: DEFAULT_QUICK_MOCK };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(LEAGUE_SETUP_STORAGE_KEY) ?? 'null');
    if (!saved || typeof saved !== 'object') return fallback;
    const item = saved as Record<string, unknown>;
    if (!(item.profile === 'quick-mock' || item.profile === 'primary-league') || !isQuickMockPreferences(item.quickMock)) return fallback;
    // The demo has no Primary League, so it always runs a quick mock.
    return { profile: IS_DEMO ? 'quick-mock' : item.profile, quickMock: item.quickMock };
  } catch { return fallback; }
}
export const useLeagueSetupStore = create<LeagueSetupState>((set) => ({
  ...readPreferences(),
  save: (profile, quickMock) => {
    if (!isQuickMockPreferences(quickMock)) return;
    const next = { profile: IS_DEMO ? 'quick-mock' as const : profile, quickMock };
    try { localStorage.setItem(LEAGUE_SETUP_STORAGE_KEY, JSON.stringify(next)); } catch { /* Session settings still work without storage. */ }
    set(next);
  },
}));
