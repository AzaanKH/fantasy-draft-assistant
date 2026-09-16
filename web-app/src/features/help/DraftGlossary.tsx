import { CircleHelp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

const TERMS = [
  {
    term: 'Value over replacement',
    short: 'VOR',
    definition:
      'Projected points minus the points expected from a replacement-level player at the same position. For example, 337 projected minus 204 replacement equals +133 VOR. This is usually more useful for drafting than raw projected points because it captures positional advantage.',
  },
  {
    term: 'Position tier',
    short: 'Tier',
    definition:
      'A group of players with similar projected value. The last player in a tier matters when the next group has a meaningful scoring drop.',
  },
  {
    term: 'Next-pick chance',
    short: 'Wait',
    definition:
      'The estimated chance that the player will still be available at your next selection. A low percentage means waiting is risky; a high percentage means you can probably address another position first.',
  },
  {
    term: 'Projected points',
    short: 'Proj.',
    definition:
      'The player\'s expected total fantasy points for the season in your scoring format. This measures total output, while VOR measures how much better that output is than an available fallback at the same position.',
  },
  {
    term: 'Expert rank and draft spot',
    short: 'ECR / ADP',
    definition:
      'ECR is the expert consensus rank. ADP is the player\'s typical draft position. If experts rank a player earlier than the typical draft spot, waiting may offer value—but only if the player is likely to remain available.',
  },
  {
    term: 'Risk',
    short: 'Risk',
    definition:
      'A combined view of availability and projection volatility. It is context for a decision, not a reason to automatically avoid a player.',
  },
] as const;

export function DraftGlossary(): React.ReactElement {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <CircleHelp />
          How scores work
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Draft score glossary</DialogTitle>
          <DialogDescription>
            Plain-language definitions for the signals used in player rankings and recommendations.
          </DialogDescription>
        </DialogHeader>

        <dl className="space-y-4">
          {TERMS.map(({ term, short, definition }) => (
            <div key={term} className="rounded-md border bg-muted/20 p-3">
              <dt className="font-semibold">
                {term}
                <span className="ml-2 font-mono text-xs text-muted-foreground">
                  {short}
                </span>
              </dt>
              <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {definition}
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
