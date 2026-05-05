/**
 * Sleeper Draft Connection Component
 *
 * Allows user to enter a Sleeper draft ID and sync picks in real-time.
 */

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSleeperDraft } from '@/hooks/useSleeperDraft';
import { useDraftStore } from '@/stores/draftStore';
import { cn } from '@/lib/utils';

export function SleeperConnect() {
  const [isOpen, setIsOpen] = React.useState(false);
  const [draftIdInput, setDraftIdInput] = React.useState('');
  const [draftPosition, setDraftPosition] = React.useState('1');
  const [connectedDraftId, setConnectedDraftId] = React.useState<string | null>(null);

  const setConfig = useDraftStore((state) => state.setConfig);
  const myPickPosition = useDraftStore((state) => state.config.myPickPosition);

  const {
    draft,
    syncStatus,
    totalPicks,
    myPicksCount,
    isLoading,
    isError,
    error,
    isDrafting,
    isComplete,
    refresh,
  } = useSleeperDraft(connectedDraftId);

  const handleConnect = () => {
    // Extract draft ID from URL if full URL is pasted
    const match = draftIdInput.match(/draft\/nfl\/(\d+)/);
    const id = match?.[1] ?? draftIdInput.trim();
    if (id) {
      // Set the user's draft position in the store
      setConfig({ myPickPosition: parseInt(draftPosition, 10) });
      setConnectedDraftId(id);
    }
  };

  const handleDisconnect = () => {
    setConnectedDraftId(null);
    setDraftIdInput('');
  };

  if (!isOpen) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsOpen(true)}
        className={cn(
          'text-xs',
          connectedDraftId && 'border-green-500 text-green-600'
        )}
      >
        {connectedDraftId ? `Connected: ${totalPicks} picks` : 'Connect Sleeper'}
      </Button>
    );
  }

  return (
    <div className="p-3 bg-muted/50 rounded-lg border space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Sleeper Draft Sync</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsOpen(false)}
          className="text-xs h-7"
        >
          Close
        </Button>
      </div>

      {!connectedDraftId ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Enter your Sleeper draft ID or paste the draft URL.
            <br />
            Find it at: sleeper.com/draft/nfl/<strong>DRAFT_ID</strong>
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="Draft ID or URL..."
              value={draftIdInput}
              onChange={(e) => setDraftIdInput(e.target.value)}
              className="text-sm flex-1"
              onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">My Draft Position:</span>
            <Select value={draftPosition} onValueChange={setDraftPosition}>
              <SelectTrigger className="w-20 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((pos) => (
                  <SelectItem key={pos} value={pos.toString()}>
                    {pos}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleConnect} size="sm" disabled={!draftIdInput.trim()}>
              Connect
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {isLoading && (
            <p className="text-xs text-muted-foreground">Loading draft...</p>
          )}

          {isError && (
            <p className="text-xs text-destructive">
              Error: {error?.message ?? 'Failed to connect'}
            </p>
          )}

          {draft && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge
                  variant="outline"
                  className={cn(
                    isDrafting && 'bg-green-500/20 text-green-700 border-green-500',
                    isComplete && 'bg-gray-500/20 text-gray-700 border-gray-500',
                    !isDrafting && !isComplete && 'bg-yellow-500/20 text-yellow-700 border-yellow-500'
                  )}
                >
                  {draft.status === 'pre_draft' && 'Waiting'}
                  {draft.status === 'drafting' && 'Live'}
                  {draft.status === 'complete' && 'Complete'}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {draft.settings.teams} teams · {draft.settings.rounds} rounds · {draft.type}
                </span>
              </div>

              <div className="flex items-center gap-2 text-xs flex-wrap">
                <span className="text-muted-foreground">
                  Synced: {totalPicks} picks
                </span>
                <span className="text-muted-foreground">
                  · My picks: {myPicksCount}
                </span>
                <span className="text-muted-foreground">
                  · Position: {myPickPosition}
                </span>
                <Badge variant="outline" className="text-xs">
                  {syncStatus}
                </Badge>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={refresh} className="text-xs h-7">
                  Refresh Now
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDisconnect}
                  className="text-xs h-7"
                >
                  Disconnect
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Picks auto-sync every 1 second during live draft.
      </p>
    </div>
  );
}
