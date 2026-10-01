import { useId, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import type { Player, Recommendation } from '@fantasy-draft/shared';
import { PlayerHeadshot } from '@/components/PlayerHeadshot';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export function ComparisonPlayerPicker({ recommendations, selectedId, playerById, onSelect }: {
  readonly recommendations: readonly Recommendation[];
  readonly selectedId: string;
  readonly playerById: ReadonlyMap<string, Player>;
  readonly onSelect: (playerId: string) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchId = useId();
  const normalizedQuery = query.trim().toLowerCase();
  const matches = recommendations.filter((player) =>
    `${player.playerName} ${player.position} ${playerById.get(player.playerId)?.team ?? ''}`.toLowerCase().includes(normalizedQuery)
  );

  return <Popover open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); setQuery(''); }}>
    <PopoverTrigger asChild>
      <Button variant="outline" size="sm" className="comparison-change-player" aria-label="Change comparison player">
        Change player <ChevronDown className="size-4" aria-hidden="true" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="w-96 rounded-md p-3" aria-label="Choose comparison player">
      <label htmlFor={searchId} className="mb-2 block text-sm font-semibold">Choose comparison player</label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden="true" />
        <Input id={searchId} type="search" value={query} onChange={(event) => { setQuery(event.target.value); }} placeholder="Search name, team, or position" className="h-10 pl-9" />
      </div>
      <p role="status" className="my-2 text-xs text-muted-foreground">{matches.length} {matches.length === 1 ? 'player' : 'players'}</p>
      <ul className="max-h-72 overflow-y-auto" aria-label="Comparison players">
        {matches.map((player) => <li key={player.playerId}>
          <button type="button" aria-pressed={player.playerId === selectedId}
            className="flex min-h-14 w-full items-center gap-3 rounded-sm px-2 py-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-muted"
            onClick={() => { onSelect(player.playerId); setOpen(false); setQuery(''); }}>
            <PlayerHeadshot playerId={player.playerId} name={player.playerName} position={player.position} className="size-10 rounded-sm" />
            <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{player.playerName}</span><span className="block text-xs text-muted-foreground">{player.position}{playerById.get(player.playerId)?.team ? ` · ${playerById.get(player.playerId)?.team}` : ''}</span></span>
            {player.playerId === selectedId ? <Check className="size-4 shrink-0 text-primary" aria-hidden="true" /> : null}
          </button>
        </li>)}
      </ul>
      {matches.length === 0 ? <p className="py-4 text-sm text-muted-foreground">No players match. Try a different name, team, or position.</p> : null}
    </PopoverContent>
  </Popover>;
}
