import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isDraftDataRefreshStatus, type DraftDataRefreshStatus } from '@fantasy-draft/shared';
import { toast } from 'sonner';

const REFRESH_URL = '/api/draft-data/refresh';
const STATUS_QUERY_KEY = ['draft-data-refresh'] as const;
/** Files the refresh rewrites; refetching them re-runs the readiness check. */
const REFRESHED_DATA_QUERY_KEYS = [['fantasypros-snapshot'], ['sleeper-adp'], ['player-identity']] as const;
const POLL_INTERVAL_MS = 1000;

async function readStatus(response: Response): Promise<DraftDataRefreshStatus> {
  if (!response.ok) throw new Error(`Draft data refresh request failed: ${String(response.status)}`);
  const body: unknown = await response.json();
  if (!isDraftDataRefreshStatus(body)) throw new Error('Draft data refresh returned an unexpected status');
  return body;
}

export interface DraftDataRefresh {
  readonly status: DraftDataRefreshStatus | undefined;
  /** False when the local API server is not reachable, so only the terminal command can help. */
  readonly isAvailable: boolean;
  readonly isStarting: boolean;
  readonly start: () => void;
}

export function useDraftDataRefresh(enabled = true): DraftDataRefresh {
  const queryClient = useQueryClient();
  const statusQuery = useQuery({
    queryKey: STATUS_QUERY_KEY,
    queryFn: async () => readStatus(await fetch(REFRESH_URL)),
    enabled,
    retry: false,
    staleTime: 0,
    refetchInterval: (query) => query.state.data?.state === 'running' ? POLL_INTERVAL_MS : false,
  });
  const startMutation = useMutation({
    mutationFn: async () => readStatus(await fetch(REFRESH_URL, { method: 'POST' })),
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
