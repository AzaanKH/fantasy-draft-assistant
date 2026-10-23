import { requestJson } from '@/lib/http';
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { decodeDraftDataRefreshStatus, type DraftDataRefreshStatus } from '@fantasy-draft/shared/catalog';
import { toast } from 'sonner';

const REFRESH_URL = '/api/draft-data/refresh';
const STATUS_QUERY_KEY = ['draft-data-refresh'] as const;
/** Files the refresh rewrites; refetching them re-runs the readiness check. */
const REFRESHED_DATA_QUERY_KEYS = [['fantasypros-snapshot'], ['sleeper-adp'], ['player-identity']] as const;
const POLL_INTERVAL_MS = 1000;

async function requestStatus(init?: RequestInit): Promise<DraftDataRefreshStatus> {
  return requestJson(REFRESH_URL, body => {
    try { return decodeDraftDataRefreshStatus(body); }
    catch { throw new Error('Draft data refresh returned an unexpected status'); }
  }, 'Draft data refresh request failed', { init });
}

export const DraftDataRefreshRequestContext = React.createContext(requestStatus);

interface DraftDataRefresh {
  readonly status: DraftDataRefreshStatus | undefined;
  /** False when the local API server is not reachable, so only the terminal command can help. */
  readonly isAvailable: boolean;
  readonly isStarting: boolean;
  readonly start: () => void;
}

export function useDraftDataRefresh(enabled = true): DraftDataRefresh {
  const queryClient = useQueryClient();
  const request = React.useContext(DraftDataRefreshRequestContext);
  const statusQuery = useQuery({
    queryKey: STATUS_QUERY_KEY,
    queryFn: () => request(),
    enabled,
    retry: false,
    staleTime: 0,
    refetchInterval: (query) => query.state.data?.state === 'running' ? POLL_INTERVAL_MS : false,
  });
  const startMutation = useMutation({
    mutationFn: () => request({ method: 'POST' }),
    // A status read still in flight could land after the POST and overwrite `running` with `idle`.
    onMutate: async () => { await queryClient.cancelQueries({ queryKey: STATUS_QUERY_KEY }); },
    onSuccess: (status) => { queryClient.setQueryData(STATUS_QUERY_KEY, status); },
    onError: () => {
      toast.error('Draft data refresh could not start', {
        id: 'draft-data-refresh',
        description: 'Start the app with `pnpm dev:live`, or run `pnpm draft:preflight` in a terminal.',
      });
    },
  });

  const state = statusQuery.data?.state;
  const finishedAt = statusQuery.data?.finishedAt;
  const previousState = React.useRef(state);
  React.useEffect(() => {
    const wasRunning = previousState.current === 'running';
    previousState.current = state;
    if (!wasRunning) return;
    if (state === 'succeeded') {
      for (const queryKey of REFRESHED_DATA_QUERY_KEYS) {
        void queryClient.invalidateQueries({ queryKey });
      }
      // A shared id keeps several mounted checklists from stacking the same notice.
      toast.success('Draft data refreshed', { id: 'draft-data-refresh' });
    } else if (state === 'failed') {
      toast.error('Draft data refresh failed', { id: 'draft-data-refresh' });
    }
  }, [finishedAt, queryClient, state]);

  return {
    status: statusQuery.data,
    isAvailable: !statusQuery.isError,
    isStarting: startMutation.isPending,
    start: () => { startMutation.mutate(); },
  };
}
