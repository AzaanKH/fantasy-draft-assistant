import type { Position } from '@fantasy-draft/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useDraftStore } from '@/stores/draftStore';

const EDITABLE_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const satisfies readonly Position[];

function numericValue(value: string, maximum: number = 20): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(0, parsed)) : 0;
}

export function RosterSettings(): React.ReactElement {
  const requirements = useDraftStore((state) => state.config.rosterRequirements);
  const leagueRoster = useDraftStore((state) => state.leagueSettings.rosterRequirements);
  const setRosterRequirements = useDraftStore((state) => state.setRosterRequirements);

  const updatePosition = (
    position: (typeof EDITABLE_POSITIONS)[number],
    field: 'starters' | 'max',
    value: number
  ): void => {
    const current = requirements[position];
    const next = field === 'starters'
      ? { starters: value, max: Math.max(value, current.max) }
      : { starters: Math.min(current.starters, value), max: value };
    setRosterRequirements({ ...requirements, [position]: next });
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">League roster</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Roster requirements</DialogTitle>
          <DialogDescription>
            These slots guide roster needs and recommendations for the selected league rules.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-[1fr_90px_90px] items-center gap-2 text-sm">
            <span className="font-medium">Position</span>
            <span className="text-xs text-muted-foreground">Starters</span>
            <span className="text-xs text-muted-foreground">Roster max</span>
            {EDITABLE_POSITIONS.map((position) => (
              <div key={position} className="contents">
                <label htmlFor={`roster-${position}-starters`} className="font-medium">
                  {position}
                </label>
                <Input
                  id={`roster-${position}-starters`}
                  type="number"
                  min={0}
                  max={10}
                  value={requirements[position].starters}
                  onChange={(event) => {
                    updatePosition(position, 'starters', numericValue(event.target.value, 10));
                  }}
                />
                <Input
                  aria-label={`${position} roster maximum`}
                  type="number"
                  min={0}
                  max={20}
                  value={requirements[position].max}
                  onChange={(event) => {
                    updatePosition(position, 'max', numericValue(event.target.value));
                  }}
                />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3 border-t pt-4">
            <label className="space-y-1 text-sm" htmlFor="roster-flex-starters">
              <span className="font-medium">FLEX starters</span>
              <Input
                id="roster-flex-starters"
                type="number"
                min={0}
                max={10}
                value={requirements.FLEX.starters}
                onChange={(event) => {
                  setRosterRequirements({
                    ...requirements,
                    FLEX: {
                      ...requirements.FLEX,
                      starters: numericValue(event.target.value, 10),
                    },
                  });
                }}
              />
              <span className="block text-xs text-muted-foreground">RB / WR / TE</span>
            </label>
            <label className="space-y-1 text-sm" htmlFor="roster-bench-spots">
              <span className="font-medium">Bench spots</span>
              <Input
                id="roster-bench-spots"
                type="number"
                min={0}
                max={20}
                value={requirements.BENCH.spots}
                onChange={(event) => {
                  setRosterRequirements({
                    ...requirements,
                    BENCH: { spots: numericValue(event.target.value) },
                  });
                }}
              />
            </label>
          </div>

          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setRosterRequirements(leagueRoster);
              }}
            >
              Reset to league rules
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
