import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { getConnectionNotice, type ConnectionNoticeState } from '@/lib/connection-notifications';

export function useConnectionNotifications(key: string | null, provider: string, state: ConnectionNoticeState['state']): void {
  const previous = useRef<ConnectionNoticeState | null>(null);
  useEffect(() => {
    const next = { key, provider, state };
    const notice = getConnectionNotice(previous.current, next);
    previous.current = next;
    if (notice) toast[notice.kind](notice.message, { id: 'draft-connection', description: notice.description });
    else if (state === 'syncing' || !key) toast.dismiss('draft-connection');
  }, [key, provider, state]);
}
