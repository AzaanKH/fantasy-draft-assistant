import { PlayerTable } from '@/features/draft-board';
import { TeamNeeds } from '@/features/team-needs';
import { Recommendations } from '@/features/recommendations';

function DraftHeader() {
  return (
    <header className="border-b border-border bg-card">
      <div className="container mx-auto px-4 py-4">
        <h1 className="text-2xl font-bold">Fantasy Draft Assistant</h1>
      </div>
    </header>
  );
}

export function App() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <DraftHeader />
      <main className="container mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Main player table - takes 3 columns on large screens */}
          <div className="lg:col-span-3">
            <PlayerTable />
          </div>

          {/* Sidebar with recommendations and team needs */}
          <div className="space-y-6">
            <Recommendations />
            <TeamNeeds />
          </div>
        </div>
      </main>
    </div>
  );
}
