import { PlayerTable } from '@/features/draft-board';
import { TeamNeeds } from '@/features/team-needs';
import { Recommendations } from '@/features/recommendations';

function DraftHeader() {
  return (
    <header className="border-b border-border/70 bg-card/80">
      <div className="mx-auto max-w-[1600px] px-4 py-4">
        <h1 className="text-xl font-bold">Fantasy Draft Assistant</h1>
      </div>
    </header>
  );
}

export function App() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <DraftHeader />
      <main className="mx-auto max-w-[1600px] px-4 py-6">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0">
            <PlayerTable />
          </div>

          <div className="min-w-0 space-y-6">
            <Recommendations />
            <TeamNeeds />
          </div>
        </div>
      </main>
    </div>
  );
}
