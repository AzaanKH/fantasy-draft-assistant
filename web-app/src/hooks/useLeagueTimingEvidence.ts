import { useQuery } from '@tanstack/react-query';
import { fetchLeagueSurvivalModel } from '@/lib/league-survival-model';
import { useLeagueSetupStore } from '@/stores/leagueSetupStore';
import { useDraftSyncConnectionStore } from '@/stores/draftSyncStore';

/** History belongs to an explicitly selected league, never to a room size. */
export function useLeagueTimingEvidence(enabled: boolean = true) {
  const profile = useLeagueSetupStore((state) => state.profile);
  const connection = useDraftSyncConnectionStore((state) => state.connection);
  const historyProfile = connection?.settingsProfile === 'quick-mock'
    ? null
    : connection?.usePrimaryLeagueSettings === true || profile === 'primary-league'
      ? 'primary-league'
      : null;
  const query = useQuery({
    queryKey: ['league-survival-model', historyProfile],
    queryFn: fetchLeagueSurvivalModel,
    enabled: enabled && historyProfile !== null,
    staleTime: Infinity,
  });

  return {
    // Disabled queries can still return cached data. Gate consumption too.
    model: historyProfile === null ? null : query.data,
    isLoading: enabled && historyProfile !== null && query.isLoading,
  };
}
